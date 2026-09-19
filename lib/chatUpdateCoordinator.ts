export type UpdateTopic = 'room' | 'inbox' | 'activity' | 'features' | 'status' | 'history';
type Watch = {load:()=>Promise<unknown>;topics:UpdateTopic[];fast:boolean;reconcileMs:number;due:number;running:boolean;again:boolean};
type Result = {path:string;status:number;data:unknown};
type Pending = {promise:Promise<Result>;resolve:(result:Result)=>void;reject:(error:unknown)=>void};
export type CoordinatorEnvironment = {fetch:typeof fetch;active:()=>boolean;now:()=>number;unauthorized?:()=>void};

/** One scheduler and batched transport per mounted, authenticated chat shell. */
export class ChatUpdateCoordinator {
  private watches = new Set<Watch>();
  private queued = new Map<string,Pending>();
  private inflight = new Map<string,Pending>();
  private controllers = new Set<AbortController>();
  private timer?:ReturnType<typeof setInterval>;
  private flushTimer?:ReturnType<typeof setTimeout>;
  private invalidationTimer?:ReturnType<typeof setTimeout>;
  private invalidated = new Set<UpdateTopic>();
  private healthy = false;
  private stopped = false;
  private generation = 0;
  constructor(private env:CoordinatorEnvironment, private pollingRoom=false) {}
  start() { this.stopped=false;this.healthy=false;this.timer=setInterval(()=>this.tick(),1000);this.flush(); }
  stop() {
    this.stopped=true;this.generation++;
    clearInterval(this.timer);clearTimeout(this.flushTimer);clearTimeout(this.invalidationTimer);
    this.timer=undefined;this.flushTimer=undefined;this.invalidationTimer=undefined;
    this.controllers.forEach(c=>c.abort());this.controllers.clear();
    const error=new Error('Chat session changed.');
    [...this.queued.values(),...this.inflight.values()].forEach(p=>p.reject(error));
    this.queued.clear();this.inflight.clear();this.invalidated.clear();
  }
  setPollingRoom(value:boolean) { if(this.pollingRoom!==value){this.pollingRoom=value;this.foreground();} }
  setHealthy(healthy:boolean) {
    if(this.healthy===healthy)return;
    this.healthy=healthy;
    // Reconcile the gap on subscribe/reconnect or transport failure.
    this.foreground();
  }
  foreground() {
    if(!this.env.active()||this.stopped)return;
    this.watches.forEach(w=>this.run(w));this.scheduleFlush();
  }
  private interval(w:Watch) { return w.fast&&(!this.healthy||(this.pollingRoom&&(w.topics.includes('room')||w.topics.includes('history'))))?2000:w.reconcileMs; }
  private tick() {
    if(!this.env.active()||this.stopped)return;
    this.watches.forEach(w=>{if(!w.running&&w.due<=this.env.now())this.run(w);});
  }
  watch(load:()=>Promise<unknown>,topics:UpdateTopic[],fast=false,reconcileMs=10000) {
    const w:Watch={load,topics,fast,reconcileMs,due:0,running:false,again:false};
    this.watches.add(w);this.run(w);
    return ()=>{this.watches.delete(w);};
  }
  private run(w:Watch) {
    if(this.stopped||!this.env.active()||!this.watches.has(w))return;
    if(w.running){w.again=true;return;}
    w.running=true;w.due=(Math.floor(this.env.now()/this.interval(w))+1)*this.interval(w);
    const generation=this.generation;
    void Promise.resolve().then(w.load).catch(()=>{/* Consumers present their own errors. */}).finally(()=>{
      w.running=false;
      // A slow request must not create an endless immediate catch-up loop.
      w.due=(Math.floor(this.env.now()/this.interval(w))+1)*this.interval(w);
      if(generation!==this.generation)return;
      if(w.again){w.again=false;this.run(w);}
    });
  }
  invalidate(...topics:UpdateTopic[]) {
    if(this.stopped)return;
    topics.forEach(topic=>this.invalidated.add(topic));
    if(this.invalidationTimer)return;
    this.invalidationTimer=setTimeout(()=>{
      this.invalidationTimer=undefined;
      const topics=this.invalidated;this.invalidated=new Set();
      this.watches.forEach(w=>{if(w.topics.some(t=>topics.has(t)))this.run(w);});
    },100);
  }
  async read(path:string):Promise<Response> {
    if(this.stopped)throw new Error("Chat session changed.");
    let pending=this.queued.get(path)??this.inflight.get(path);
    if(!pending){
      let resolve!:Pending['resolve'],reject!:Pending['reject'];
      const promise=new Promise<Result>((yes,no)=>{resolve=yes;reject=no;});
      pending={promise,resolve,reject};this.queued.set(path,pending);this.scheduleFlush();
    }
    const result=await pending.promise;
    return new Response(JSON.stringify(result.data),{status:result.status,headers:{'Content-Type':'application/json'}});
  }
  private scheduleFlush() {
    if(this.flushTimer||this.stopped)return;
    this.flushTimer=setTimeout(()=>{this.flushTimer=undefined;this.flush();},20);
  }
  private flush() {
    if(this.stopped||!this.env.active()||!this.queued.size)return;
    const batch=[...this.queued.entries()].slice(0,8);
    batch.forEach(([path,p])=>{this.queued.delete(path);this.inflight.set(path,p);});
    if(this.queued.size)this.scheduleFlush();
    const generation=this.generation;
    const controller=new AbortController();this.controllers.add(controller);
    // Bound hung requests so reconnection cannot be held hostage indefinitely.
    const timeout=setTimeout(()=>controller.abort(),15000);
    void this.env.fetch('/api/chat/updates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:batch.map(([path])=>path)}),cache:'no-store',signal:controller.signal})
      .then(async response=>{
        if(this.stopped||generation!==this.generation)return;
        if(response.status===401||response.status===403)this.env.unauthorized?.();
        const body=await response.json();
        for(const [path,p] of batch){
          const result:Result|undefined=response.ok?body.results?.find((r:Result)=>r.path===path):{path,status:response.status,data:body};
          if(result)p.resolve(result);else p.reject(new Error('Incomplete chat update.'));
        }
      }).catch(error=>batch.forEach(([,p])=>p.reject(error)))
      .finally(()=>{clearTimeout(timeout);this.controllers.delete(controller);batch.forEach(([path,p])=>{if(this.inflight.get(path)===p)this.inflight.delete(path);});});
  }
}
