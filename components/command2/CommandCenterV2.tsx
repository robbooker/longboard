"use client";

import React from "react";

export default function CommandCenterV2() {
  return (
    <div className="cc2-root">
      <style>{`
        .cc2-root{
          --cream:#F6F2E9;
          --card:#FBF8F0;
          --card-2:#EFEADD;
          --ink:#15120B;
          --ink-70:rgba(21,18,11,0.72);
          --ink-55:rgba(21,18,11,0.55);
          --ink-30:rgba(21,18,11,0.16);
          --amber:#F5A524;
          --gold:#B8860B;
          --up:oklch(0.58 0.13 148);
          --down:oklch(0.55 0.18 28);
          --paper:rgba(244,241,232,0.85);
          --paper-55:rgba(244,241,232,0.55);
          --paper-18:rgba(244,241,232,0.18);
          background:var(--cream);
          color:var(--ink);
          font-family:Helvetica,Arial,sans-serif;
          -webkit-font-smoothing:antialiased;
          min-height:100vh;
        }
        .cc2-root *{box-sizing:border-box}
        .cc2-root a{color:inherit;text-decoration:none}
        .cc2-root .mono{font-family:'Courier New',Courier,monospace;letter-spacing:1.6px;text-transform:uppercase;font-weight:700}
        .cc2-root .ed{font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:500}

        /* ===== TOP NAV ===== */
        .cc2-root .nav{
          background:var(--ink);color:var(--paper);
          border-bottom:1px solid #000;
        }
        .cc2-root .nav-inner{
          max-width:1480px;margin:0 auto;
          display:flex;align-items:center;gap:32px;
          padding:14px 28px;
        }
        .cc2-root .brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-0.4px;font-size:18px}
        .cc2-root .brand .mark{
          width:26px;height:26px;background:var(--amber);color:var(--ink);
          display:grid;place-items:center;font-weight:900;font-size:14px;
        }
        .cc2-root .brand em{font-family:Georgia,serif;color:var(--amber);font-weight:500}
        .cc2-root .nav ul{list-style:none;margin:0;padding:0;display:flex;gap:22px;font-size:13px;font-weight:600;color:rgba(244,241,232,0.78)}
        .cc2-root .nav ul li.active{color:var(--amber)}
        .cc2-root .nav ul li.active::before{content:"● ";font-size:9px;vertical-align:middle;margin-right:4px}
        .cc2-root .nav-right{margin-left:auto;display:flex;align-items:center;gap:18px;font-size:12px;color:rgba(244,241,232,0.7)}
        .cc2-root .search{
          display:flex;align-items:center;gap:8px;
          background:rgba(244,241,232,0.06);
          border:1px solid rgba(244,241,232,0.14);
          padding:7px 12px;min-width:240px;
          font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.4px;
          color:rgba(244,241,232,0.6);
        }
        .cc2-root .search .kbd{margin-left:auto;border:1px solid rgba(244,241,232,0.2);padding:1px 6px;font-size:10px}
        .cc2-root .live-pip{
          display:inline-flex;align-items:center;gap:6px;
          color:var(--amber);font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.6px;font-weight:700;
        }
        .cc2-root .live-pip::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 0 rgba(245,165,36,0.6);animation:cc2-pulse 1.6s infinite}
        @keyframes cc2-pulse{
          0%{box-shadow:0 0 0 0 rgba(245,165,36,0.55)}
          70%{box-shadow:0 0 0 8px rgba(245,165,36,0)}
          100%{box-shadow:0 0 0 0 rgba(245,165,36,0)}
        }
        .cc2-root .avatar{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#F5A524,#B8860B);display:grid;place-items:center;color:var(--ink);font-weight:800;font-size:12px}

        /* ===== TICKER STRIP ===== */
        .cc2-root .strip{
          background:var(--ink);color:var(--paper);
          border-top:1px solid rgba(244,241,232,0.08);
          overflow:hidden;
          font-family:'Courier New',monospace;font-size:12px;letter-spacing:1.4px;
        }
        .cc2-root .strip-inner{
          display:flex;align-items:center;gap:0;
          padding:10px 28px;
          max-width:1480px;margin:0 auto;
          white-space:nowrap;
        }
        .cc2-root .strip-tag{
          color:var(--amber);font-weight:700;margin-right:18px;
          border-right:1px solid rgba(244,241,232,0.18);padding-right:18px;
        }
        .cc2-root .ticks{display:flex;gap:24px;overflow:hidden;flex:1}
        .cc2-root .tick{display:inline-flex;align-items:baseline;gap:8px}
        .cc2-root .tick b{color:var(--paper);font-family:Helvetica,Arial,sans-serif;font-weight:800;letter-spacing:-0.3px}
        .cc2-root .tick .up{color:var(--amber)}
        .cc2-root .tick .dn{color:#E66B5C}
        .cc2-root .clock{margin-left:auto;color:rgba(244,241,232,0.55);padding-left:18px;border-left:1px solid rgba(244,241,232,0.18)}

        /* ===== PAGE HEADER ===== */
        .cc2-root .page{
          max-width:1480px;margin:0 auto;
          padding:32px 28px 12px;
        }
        .cc2-root .crumb{font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.8px;color:var(--gold);font-weight:700;margin-bottom:14px}
        .cc2-root .crumb span{color:var(--ink-55);margin:0 8px}
        .cc2-root .page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;border-bottom:2px solid var(--amber);padding-bottom:22px}
        .cc2-root h1{
          margin:0;font-size:64px;line-height:0.94;letter-spacing:-2.6px;font-weight:800;
        }
        .cc2-root h1 .ed{display:inline;letter-spacing:-1.6px}
        .cc2-root .sub{font-family:Georgia,serif;font-style:italic;font-size:18px;color:var(--ink-70);margin-top:14px;max-width:620px;line-height:1.45}
        .cc2-root .head-meta{
          display:flex;gap:28px;align-items:flex-end;
          font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.4px;color:var(--ink-55);font-weight:700;
        }
        .cc2-root .head-meta div b{display:block;font-family:Helvetica,Arial,sans-serif;font-size:22px;letter-spacing:-0.6px;color:var(--ink);margin-top:4px;font-weight:800}
        .cc2-root .head-meta div b.amb{color:var(--gold)}

        /* ===== MAIN GRID ===== */
        .cc2-root .grid{
          max-width:1480px;margin:0 auto;
          padding:28px 28px 64px;
          display:grid;grid-template-columns:2fr 1fr;gap:28px;
        }
        @media (max-width:1080px){ .cc2-root .grid{grid-template-columns:1fr} }

        /* ===== LEFT COLUMN ===== */
        .cc2-root .col-head{
          display:flex;align-items:center;justify-content:space-between;gap:16px;
          border-top:2px solid var(--amber);padding-top:16px;margin-bottom:18px;
        }
        .cc2-root .col-head .mono{font-size:11px;color:var(--gold)}
        .cc2-root .pill-row{display:flex;gap:6px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.4px;font-weight:700}
        .cc2-root .pill{padding:5px 10px;border:1px solid var(--ink-30);color:var(--ink-70)}
        .cc2-root .pill.on{background:var(--ink);color:var(--amber);border-color:var(--ink)}

        /* HERO PICK */
        .cc2-root .hero{
          background:var(--card);border:1px solid var(--ink-30);
          padding:0;overflow:hidden;
        }
        .cc2-root .hero-top{
          display:grid;grid-template-columns:170px 1fr auto;
          align-items:center;gap:18px;
          padding:26px 28px 22px;
          border-bottom:1px solid var(--ink-30);
        }
        .cc2-root .pick-num{font-size:140px;font-weight:800;color:var(--amber);letter-spacing:-7px;line-height:0.82;font-family:Helvetica,Arial,sans-serif}
        .cc2-root .ticker-block .sym{font-size:68px;font-weight:800;letter-spacing:-3px;line-height:0.95}
        .cc2-root .ticker-block .name{font-family:Georgia,serif;font-style:italic;font-size:18px;color:var(--ink-70);margin-top:8px}
        .cc2-root .ticker-block .tags{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}
        .cc2-root .tag{font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.4px;font-weight:700;background:var(--card-2);color:var(--ink);padding:5px 9px}
        .cc2-root .tag.star{background:var(--ink);color:var(--amber)}

        .cc2-root .hero-price{text-align:right}
        .cc2-root .hero-price .mono{color:var(--gold);font-size:10px}
        .cc2-root .hero-price .pct{font-size:46px;font-weight:800;letter-spacing:-1.6px;color:var(--ink);line-height:1}
        .cc2-root .hero-price .pct b{color:var(--gold)}
        .cc2-root .hero-price .px{font-family:Helvetica;font-size:24px;font-weight:800;letter-spacing:-0.8px;margin-top:4px}
        .cc2-root .hero-price .px small{font-family:'Courier New',monospace;font-size:11px;color:var(--ink-55);letter-spacing:1.2px;font-weight:700;margin-left:6px}

        /* sparkline strip */
        .cc2-root .spark-bar{
          background:var(--ink);color:var(--paper);
          padding:18px 28px;display:grid;grid-template-columns:1fr 1.4fr 1fr;gap:24px;align-items:center;
        }
        .cc2-root .spark-bar .lbl{font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.4px;color:var(--paper-55);font-weight:700;margin-bottom:6px}
        .cc2-root .spark-bar .v{font-family:Helvetica;font-size:22px;font-weight:800;letter-spacing:-0.8px;color:var(--paper)}
        .cc2-root .spark-bar .v.amb{color:var(--amber)}
        .cc2-root .spark-bar svg{width:100%;height:60px;display:block}
        .cc2-root .spark-meta{display:flex;flex-direction:column;gap:6px;font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.2px;color:var(--paper-55);font-weight:700}
        .cc2-root .spark-meta b{color:var(--paper);font-family:Helvetica,Arial,sans-serif;letter-spacing:-0.4px}

        .cc2-root .hero-body{padding:26px 28px 22px;display:grid;grid-template-columns:1.4fr 1fr;gap:28px}
        .cc2-root .catalyst h3{margin:0 0 10px;font-size:20px;letter-spacing:-0.4px;line-height:1.35}
        .cc2-root .catalyst ul{margin:0;padding-left:18px}
        .cc2-root .catalyst li{font-family:Georgia,serif;font-size:15px;line-height:1.5;color:var(--ink);margin-bottom:6px}
        .cc2-root .risks{margin-top:14px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.4px;color:var(--gold);font-weight:700;line-height:1.6}

        .cc2-root .targets{background:var(--card-2);padding:18px 20px}
        .cc2-root .targets h4{margin:0 0 12px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.6px;color:var(--gold);font-weight:700}
        .cc2-root .lvl{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:10px 0;border-top:1px solid var(--ink-30)}
        .cc2-root .lvl:first-of-type{border-top:none}
        .cc2-root .lvl .k{font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.4px;color:var(--gold);font-weight:700}
        .cc2-root .lvl .k.dn{color:var(--ink-55)}
        .cc2-root .lvl .v{font-weight:800;letter-spacing:-0.4px;font-size:18px}
        .cc2-root .lvl .v small{color:var(--ink-55);font-weight:700;font-size:13px;margin-left:4px}

        .cc2-root .hero-foot{
          border-top:1px solid var(--ink-30);
          padding:14px 28px;
          display:flex;justify-content:space-between;align-items:center;gap:14px;
          font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.3px;color:var(--ink-70);font-weight:700;
        }
        .cc2-root .hero-foot .actions{display:flex;gap:8px}
        .cc2-root .btn{font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.6px;font-weight:700;padding:8px 14px;border:1px solid var(--ink);background:var(--card);color:var(--ink);cursor:pointer}
        .cc2-root .btn.primary{background:var(--ink);color:var(--amber)}
        .cc2-root .btn.amber{background:var(--amber);color:var(--ink);border-color:var(--amber)}

        /* RANKED LIST */
        .cc2-root .row{
          background:var(--card);border:1px solid var(--ink-30);
          border-top:none;
          display:grid;grid-template-columns:90px 1.4fr 1fr 1.6fr auto;
          gap:18px;align-items:center;
          padding:18px 22px;
        }
        .cc2-root .row:first-of-type{border-top:1px solid var(--ink-30)}
        .cc2-root .row .num{font-size:64px;font-weight:800;color:var(--gold);letter-spacing:-3px;line-height:0.85;font-family:Helvetica,Arial,sans-serif}
        .cc2-root .row .sym{font-size:34px;font-weight:800;letter-spacing:-1.4px;line-height:1}
        .cc2-root .row .name{font-family:Georgia,serif;font-style:italic;font-size:13px;color:var(--ink-55);margin-top:4px;line-height:1.3}
        .cc2-root .row .pct{font-size:30px;font-weight:800;color:var(--gold);letter-spacing:-1px;line-height:1}
        .cc2-root .row .px{font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.2px;color:var(--ink-70);font-weight:700;margin-top:6px}
        .cc2-root .row .blurb{font-size:14px;line-height:1.4;color:var(--ink);font-weight:600;letter-spacing:-0.2px}
        .cc2-root .row .blurb .micro{display:block;margin-top:6px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.2px;color:var(--gold);font-weight:700}
        .cc2-root .row svg.spark{width:88px;height:36px;display:block}
        .cc2-root .row .right{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
        .cc2-root .row .right .vol{font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.2px;color:var(--ink-55);font-weight:700}
        .cc2-root .row .right .go{font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.6px;color:var(--ink);font-weight:700;border-bottom:1px solid var(--ink)}

        /* ===== RIGHT RAIL ===== */
        .cc2-root .rail{display:flex;flex-direction:column;gap:18px}
        .cc2-root .panel{background:var(--card);border:1px solid var(--ink-30)}
        .cc2-root .panel.dark{background:var(--ink);color:var(--paper);border-color:#000}
        .cc2-root .panel-head{
          display:flex;justify-content:space-between;align-items:center;gap:10px;
          padding:14px 18px;border-bottom:1px solid var(--ink-30);
          font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.6px;font-weight:700;color:var(--gold);
        }
        .cc2-root .panel.dark .panel-head{border-color:var(--paper-18);color:var(--amber)}
        .cc2-root .panel-head .right{color:var(--ink-55);font-size:10px}
        .cc2-root .panel.dark .panel-head .right{color:var(--paper-55)}

        /* webinar */
        .cc2-root .video{
          position:relative;aspect-ratio:16/9;
          background:radial-gradient(ellipse at 30% 40%,#3a2c14 0%,#15120B 70%);
          color:var(--paper);overflow:hidden;
        }
        .cc2-root .video::before{
          content:"";position:absolute;inset:0;
          background-image:repeating-linear-gradient(0deg,rgba(244,241,232,0.04) 0 1px,transparent 1px 4px);
          pointer-events:none;
        }
        .cc2-root .video-figure{
          position:absolute;inset:0;display:grid;place-items:center;
        }
        .cc2-root .speaker{
          width:62%;aspect-ratio:1;border-radius:50%;
          background:
            radial-gradient(circle at 50% 35%, #d09a55 0%, #8b5e2c 35%, #3a2818 70%, transparent 72%),
            radial-gradient(circle at 50% 78%, #2a1f10 0%, transparent 50%);
          filter:contrast(1.05);
          position:relative;
        }
        .cc2-root .speaker::after{
          content:"";position:absolute;inset:0;border-radius:50%;
          box-shadow:inset 0 -40px 60px rgba(0,0,0,0.5),inset 0 30px 60px rgba(245,165,36,0.08);
        }
        .cc2-root .video .live{
          position:absolute;top:14px;left:14px;
          display:inline-flex;align-items:center;gap:6px;
          background:#C5402F;color:#fff;padding:5px 9px;
          font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.6px;font-weight:700;
        }
        .cc2-root .video .live::before{content:"";width:6px;height:6px;border-radius:50%;background:#fff;animation:cc2-pulse 1.4s infinite}
        .cc2-root .video .viewers{position:absolute;top:14px;right:14px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.4px;color:var(--paper-55);font-weight:700}
        .cc2-root .video .lower3{
          position:absolute;left:14px;right:14px;bottom:14px;
          background:rgba(21,18,11,0.65);backdrop-filter:blur(6px);
          border-left:3px solid var(--amber);
          padding:10px 12px;
          display:flex;justify-content:space-between;align-items:center;gap:10px;
        }
        .cc2-root .lower3 .who{font-family:Helvetica;font-weight:800;font-size:14px;letter-spacing:-0.3px;color:var(--paper)}
        .cc2-root .lower3 .who small{display:block;font-family:Georgia,serif;font-style:italic;font-size:12px;color:var(--paper-55);font-weight:500;margin-top:2px;letter-spacing:0}
        .cc2-root .lower3 .topic{font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.4px;color:var(--amber);font-weight:700;text-align:right}

        .cc2-root .video-controls{
          display:flex;align-items:center;gap:14px;
          padding:12px 16px;
          background:var(--ink);color:var(--paper);
          border-top:1px solid var(--paper-18);
          font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.4px;color:var(--paper-55);font-weight:700;
        }
        .cc2-root .vc-icon{width:18px;height:18px;display:inline-grid;place-items:center;color:var(--paper)}
        .cc2-root .video-controls .bar{flex:1;height:3px;background:var(--paper-18);position:relative}
        .cc2-root .video-controls .bar::before{content:"";position:absolute;left:0;top:0;height:100%;width:38%;background:var(--amber)}

        /* webinar agenda */
        .cc2-root .agenda{padding:14px 18px}
        .cc2-root .agenda-row{
          display:grid;grid-template-columns:54px 1fr auto;gap:12px;align-items:center;
          padding:10px 0;border-top:1px solid var(--ink-30);
        }
        .cc2-root .agenda-row:first-child{border-top:none}
        .cc2-root .agenda-row .t{font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.2px;color:var(--ink-55);font-weight:700}
        .cc2-root .agenda-row .t.now{color:var(--gold)}
        .cc2-root .agenda-row .what{font-size:13px;font-weight:600}
        .cc2-root .agenda-row .what em{display:block;font-family:Georgia,serif;font-size:12px;color:var(--ink-55);margin-top:2px}
        .cc2-root .agenda-row .badge{font-family:'Courier New',monospace;font-size:9px;letter-spacing:1.4px;color:var(--ink-55);font-weight:700}
        .cc2-root .agenda-row .badge.live{color:var(--amber);background:var(--ink);padding:3px 7px}

        /* chat */
        .cc2-root .chat-body{padding:6px 14px 0;max-height:260px;overflow:hidden;position:relative}
        .cc2-root .chat-body::after{content:"";position:absolute;left:0;right:0;top:0;height:24px;background:linear-gradient(var(--card),transparent);pointer-events:none}
        .cc2-root .msg{padding:8px 4px;border-bottom:1px dashed var(--ink-30);font-size:13px;line-height:1.4}
        .cc2-root .msg:last-child{border-bottom:none}
        .cc2-root .msg .who{font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.3px;color:var(--gold);font-weight:700;margin-right:8px}
        .cc2-root .msg .who.mod{color:var(--ink);background:var(--amber);padding:2px 6px}
        .cc2-root .msg .who.you{color:var(--ink)}
        .cc2-root .chat-input{
          display:flex;gap:8px;align-items:center;
          padding:10px 14px;border-top:1px solid var(--ink-30);background:var(--card-2);
          font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.2px;color:var(--ink-55);
        }
        .cc2-root .chat-input input{flex:1;border:none;background:transparent;font:inherit;color:var(--ink);outline:none}
        .cc2-root .chat-input button{font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.6px;font-weight:700;padding:6px 10px;background:var(--ink);color:var(--amber);border:none;cursor:pointer}

        /* alerts feed */
        .cc2-root .alerts .alert{
          display:grid;grid-template-columns:60px 1fr auto;gap:10px;align-items:flex-start;
          padding:12px 18px;border-top:1px solid var(--paper-18);
        }
        .cc2-root .alerts .alert:first-child{border-top:none}
        .cc2-root .alerts .t{font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.2px;color:var(--paper-55);font-weight:700;padding-top:2px}
        .cc2-root .alerts .body{font-size:13px;line-height:1.4;color:var(--paper)}
        .cc2-root .alerts .body b{color:var(--amber);font-weight:800}
        .cc2-root .alerts .body em{font-family:Georgia,serif;color:var(--paper-55);font-style:italic;font-weight:500}
        .cc2-root .alerts .pct{font-family:Helvetica;font-weight:800;font-size:14px;letter-spacing:-0.4px;color:var(--amber)}
        .cc2-root .alerts .pct.dn{color:#E66B5C}

        /* editors take */
        .cc2-root .take{padding:18px 18px 20px}
        .cc2-root .take .quote{font-family:Georgia,serif;font-style:italic;font-size:18px;line-height:1.45;color:var(--ink);border-left:3px solid var(--amber);padding:4px 0 4px 14px}
        .cc2-root .take .who{margin-top:14px;display:flex;align-items:center;gap:10px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.4px;color:var(--ink-55);font-weight:700}
        .cc2-root .take .who .av{width:28px;height:28px;background:linear-gradient(135deg,#F5A524,#B8860B);border-radius:50%;display:grid;place-items:center;font-family:Helvetica;color:var(--ink);font-weight:800;font-size:11px;letter-spacing:0;text-transform:none}
        .cc2-root .take .who b{color:var(--ink);font-family:Helvetica;font-weight:800;letter-spacing:-0.3px;text-transform:none}

        /* market pulse mini */
        .cc2-root .pulse{display:grid;grid-template-columns:1fr 1fr;gap:0}
        .cc2-root .pulse > div{padding:14px 16px;border-top:1px solid var(--paper-18);border-right:1px solid var(--paper-18)}
        .cc2-root .pulse > div:nth-child(2n){border-right:none}
        .cc2-root .pulse > div:nth-child(-n+2){border-top:none}
        .cc2-root .pulse .lbl{font-family:'Courier New',monospace;font-size:9px;letter-spacing:1.4px;color:var(--paper-55);font-weight:700;margin-bottom:6px}
        .cc2-root .pulse .v{font-family:Helvetica;font-size:22px;font-weight:800;letter-spacing:-0.8px;line-height:1}
        .cc2-root .pulse .v.amb{color:var(--amber)}
        .cc2-root .pulse .sub{font-family:Georgia,serif;font-style:italic;font-size:11px;color:var(--paper-55);margin-top:4px}

        /* footer */
        .cc2-root .foot{
          max-width:1480px;margin:0 auto;
          padding:16px 28px 32px;
          font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.4px;color:var(--ink-55);font-weight:700;
          display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;
        }
      `}</style>

      {/* =============== TOP NAV =============== */}
      <nav className="nav">
        <div className="nav-inner">
          <div className="brand">
            <span className="mark">L</span>
            LONGBOARD<em>AI</em>
          </div>
          <ul>
            <li className="active">Command Center</li>
            <li>Morning Brief</li>
            <li>Screeners</li>
            <li>Watchlists</li>
            <li>Replays</li>
            <li>Education</li>
          </ul>
          <div className="nav-right">
            <span className="live-pip">MARKET OPEN · 9:42 ET</span>
            <div className="search">
              <span>🔍</span>
              <span>SEARCH TICKERS, FILINGS…</span>
              <span className="kbd">⌘K</span>
            </div>
            <span>Plan: Pro</span>
            <div className="avatar">RD</div>
          </div>
        </div>
      </nav>

      {/* =============== TICKER STRIP =============== */}
      <div className="strip">
        <div className="strip-inner">
          <span className="strip-tag">● LIVE TAPE</span>
          <div className="ticks">
            <span className="tick"><b>SPY</b> 547.12 <span className="up">+0.42%</span></span>
            <span className="tick"><b>QQQ</b> 478.04 <span className="up">+0.81%</span></span>
            <span className="tick"><b>IWM</b> 218.66 <span className="dn">-0.12%</span></span>
            <span className="tick"><b>VIX</b> 14.22 <span className="dn">-3.10%</span></span>
            <span className="tick"><b>DXY</b> 102.41 <span className="up">+0.06%</span></span>
            <span className="tick"><b>BTC</b> 71,420 <span className="up">+1.84%</span></span>
            <span className="tick"><b>WTI</b> 79.10 <span className="dn">-0.55%</span></span>
            <span className="tick"><b>10Y</b> 4.18% <span className="up">+2bp</span></span>
          </div>
          <span className="clock">FRI · MAY 1 · 2026</span>
        </div>
      </div>

      {/* =============== PAGE HEADER =============== */}
      <section className="page">
        <div className="crumb">DASHBOARD <span>/</span> COMMAND CENTER <span>/</span> SESSION 05.01.2026</div>
        <div className="page-head">
          <div>
            <h1>Five names<br /><span className="ed">on the radar</span> this morning.</h1>
            <p className="sub">Ranked by conviction. Live tape, AI catalyst reads, risk flags, price targets — and the editorial team in the right rail, walking it as it breaks.</p>
          </div>
          <div className="head-meta">
            <div>AVG MOVE<b className="amb">+60.5%</b></div>
            <div>TOP RUNNER<b className="amb">CUE</b></div>
            <div>TOTAL VOL<b>111.4M</b></div>
            <div>SESSION<b>OPEN +12m</b></div>
          </div>
        </div>
      </section>

      {/* =============== MAIN GRID =============== */}
      <section className="grid">

        {/* ============== LEFT COLUMN ============== */}
        <div className="col-left">
          <div className="col-head">
            <div className="mono">★ TODAY&apos;S BOARD · 5 NAMES</div>
            <div className="pill-row">
              <span className="pill on">Movers</span>
              <span className="pill">Catalysts</span>
              <span className="pill">My Watchlist</span>
              <span className="pill">Halts</span>
            </div>
          </div>

          {/* HERO PICK */}
          <article className="hero">
            <div className="hero-top">
              <div className="pick-num">01</div>
              <div className="ticker-block">
                <div className="sym">CUE</div>
                <div className="name">Cue Biopharma, Inc.</div>
                <div className="tags">
                  <span className="tag star">★ TOP PICK</span>
                  <span className="tag">BIOTECH</span>
                  <span className="tag">LICENSING DEAL</span>
                  <span className="tag">LOW FLOAT 3.3M</span>
                </div>
              </div>
              <div className="hero-price">
                <div className="mono">AT THE OPEN</div>
                <div className="pct"><b>+114.9%</b></div>
                <div className="px">$31.68 <small>· $14.74 PREV</small></div>
              </div>
            </div>

            {/* spark bar */}
            <div className="spark-bar">
              <div>
                <div className="lbl">INTRADAY · 1m</div>
                <div className="v amb">$31.68</div>
                <div className="mono" style={{ fontSize: "10px", color: "var(--paper-55)", marginTop: "4px" }}>VWAP $26.40 · HOD $33.10</div>
              </div>
              <div>
                <svg viewBox="0 0 300 60" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="cc2-spark-grad" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0" stopColor="#F5A524" stopOpacity="0.5"></stop>
                      <stop offset="1" stopColor="#F5A524" stopOpacity="0"></stop>
                    </linearGradient>
                  </defs>
                  <path d="M0,52 L18,48 L34,50 L52,42 L70,38 L88,40 L106,30 L124,32 L142,22 L160,18 L178,22 L196,12 L214,16 L232,8 L250,10 L268,4 L286,8 L300,6 L300,60 L0,60 Z" fill="url(#cc2-spark-grad)"></path>
                  <path d="M0,52 L18,48 L34,50 L52,42 L70,38 L88,40 L106,30 L124,32 L142,22 L160,18 L178,22 L196,12 L214,16 L232,8 L250,10 L268,4 L286,8 L300,6" stroke="#F5A524" strokeWidth="1.6" fill="none"></path>
                  <line x1="0" y1="34" x2="300" y2="34" stroke="rgba(244,241,232,0.18)" strokeDasharray="2 4"></line>
                  <text x="296" y="32" textAnchor="end" fill="rgba(244,241,232,0.45)" fontFamily="Courier New" fontSize="8">VWAP</text>
                </svg>
              </div>
              <div className="spark-meta">
                <span>VOL <b>5.2M</b></span>
                <span>FLOAT <b>3.3M</b></span>
                <span>MCAP <b>$41M</b></span>
                <span>SHORT INT <b>9.4%</b></span>
              </div>
            </div>

            <div className="hero-body">
              <div className="catalyst">
                <div className="mono" style={{ fontSize: "10px", color: "var(--gold)", marginBottom: "10px" }}>→ THE CATALYST</div>
                <h3>Surges on Ascendant‑221 anti‑IgE licensing deal, $30M PIPE, new CEO, and 1‑for‑30 reverse split combo.</h3>
                <ul>
                  <li>Licensed Phase 2 anti‑IgE antibody Ascendant‑221 for allergic diseases.</li>
                  <li>$15M upfront, up to $676.5M in milestones plus royalties.</li>
                  <li>Concurrent $30M PIPE at $11.00 effective price; closes May 4.</li>
                  <li>1‑for‑30 reverse split live; new CEO Shao‑Lee Lin appointed.</li>
                </ul>
                <div className="risks">▲ RISK FLAGS · DILUTION · PIPE OVERHANG · REVERSE SPLIT · LOW FLOAT · CASH BURN · WARRANT OVERHANG</div>
              </div>

              <div className="targets">
                <h4>AI PRICE TARGETS · 30 DAY</h4>
                <div className="lvl"><span className="k">UPSIDE</span><span className="v">$42.50 <small>+34.2%</small></span></div>
                <div className="lvl"><span className="k">STRETCH</span><span className="v">$58.00 <small>+83.1%</small></span></div>
                <div className="lvl"><span className="k dn">DOWNSIDE</span><span className="v">$19.00 <small>−40.0%</small></span></div>
                <div className="mono" style={{ fontSize: "9px", color: "var(--ink-55)", marginTop: "12px", lineHeight: "1.5" }}>AI‑GENERATED · NOT ANALYST TARGETS · NOT FINANCIAL ADVICE</div>
              </div>
            </div>

            <div className="hero-foot">
              <div><strong style={{ color: "var(--ink)" }}>$31.68</strong> · <span style={{ color: "var(--gold)" }}>+114.9%</span> · VOL 5.2M · MCAP $41M · BORROW 18%</div>
              <div className="actions">
                <button className="btn">+ WATCH</button>
                <button className="btn">SET ALERT</button>
                <button className="btn amber">OPEN CHART →</button>
              </div>
            </div>
          </article>

          {/* RANKED ROWS */}
          <div style={{ marginTop: "22px" }}></div>

          <article className="row">
            <div className="num">02</div>
            <div>
              <div className="sym">ESPR</div>
              <div className="name">Esperion Therapeutics</div>
            </div>
            <div>
              <div className="pct">+57.3%</div>
              <div className="px">$3.15 · VOL 33.5M</div>
            </div>
            <div className="blurb">
              ARCHIMED to acquire Esperion at $3.16 cash plus CVR up to $100M.
              <span className="micro">▲ M&amp;A · DEAL‑SPREAD RISK · VOTE PENDING</span>
            </div>
            <div className="right">
              <svg className="spark" viewBox="0 0 88 36" preserveAspectRatio="none">
                <path d="M0,30 L10,28 L20,24 L30,22 L40,16 L50,12 L60,8 L70,6 L80,5 L88,4" stroke="#B8860B" strokeWidth="1.6" fill="none"></path>
              </svg>
              <span className="vol">MCAP $492M</span>
              <span className="go">DETAIL →</span>
            </div>
          </article>

          <article className="row">
            <div className="num">03</div>
            <div>
              <div className="sym">SOBR</div>
              <div className="name">SOBR Safe, Inc.</div>
            </div>
            <div>
              <div className="pct">+55.0%</div>
              <div className="px">$0.85 · VOL 51.3M</div>
            </div>
            <div className="blurb">
              Stock‑for‑stock merger with Clean World Ventures pivots shell to AI data‑center play.
              <span className="micro">▲ GOING CONCERN · 98/2 SPLIT · SUB‑$1</span>
            </div>
            <div className="right">
              <svg className="spark" viewBox="0 0 88 36" preserveAspectRatio="none">
                <path d="M0,28 L10,30 L20,22 L30,26 L40,18 L50,14 L60,18 L70,10 L80,12 L88,6" stroke="#B8860B" strokeWidth="1.6" fill="none"></path>
              </svg>
              <span className="vol">MCAP $1M</span>
              <span className="go">DETAIL →</span>
            </div>
          </article>

          <article className="row">
            <div className="num">04</div>
            <div>
              <div className="sym">LABT</div>
              <div className="name">Lakewood‑Amedex Biotherapeutics</div>
            </div>
            <div>
              <div className="pct">+48.1%</div>
              <div className="px">$3.94 · VOL 20.4M</div>
            </div>
            <div className="blurb">
              Phase 2a trial initiation date for Nu‑3 in infected diabetic foot ulcers; full‑float churn intraday.
              <span className="micro">▲ LOW FLOAT · DILUTION · SERIES C CONVERSION</span>
            </div>
            <div className="right">
              <svg className="spark" viewBox="0 0 88 36" preserveAspectRatio="none">
                <path d="M0,32 L10,28 L20,30 L30,22 L40,18 L50,22 L60,12 L70,16 L80,10 L88,12" stroke="#B8860B" strokeWidth="1.6" fill="none"></path>
              </svg>
              <span className="vol">MCAP $55M</span>
              <span className="go">DETAIL →</span>
            </div>
          </article>

          <article className="row">
            <div className="num">05</div>
            <div>
              <div className="sym">AKAN</div>
              <div className="name">Akanda Corp.</div>
            </div>
            <div>
              <div className="pct">+27.4%</div>
              <div className="px">$62.39 · VOL 1.0M</div>
            </div>
            <div className="blurb">
              Post‑reverse‑split squeeze on 534K float — no fresh fundamental catalyst behind the move.
              <span className="micro">▲ HALT RISK · 1‑FOR‑4.5 SPLIT · DELISTING FLAG</span>
            </div>
            <div className="right">
              <svg className="spark" viewBox="0 0 88 36" preserveAspectRatio="none">
                <path d="M0,24 L10,20 L20,28 L30,16 L40,22 L50,12 L60,18 L70,8 L80,16 L88,10" stroke="#B8860B" strokeWidth="1.6" fill="none"></path>
              </svg>
              <span className="vol">MCAP $9M</span>
              <span className="go">DETAIL →</span>
            </div>
          </article>

          {/* editor's note bar */}
          <div style={{ background: "var(--ink)", color: "var(--paper)", padding: "22px 26px", marginTop: "22px", borderLeft: "4px solid var(--amber)" }}>
            <div className="mono" style={{ color: "var(--amber)", fontSize: "10px", marginBottom: "8px" }}>→ GAME PLAN · OPEN +12m</div>
            <div style={{ fontFamily: "Georgia,serif", fontStyle: "italic", fontSize: "18px", lineHeight: "1.5", maxWidth: "680px" }}>
              Demand confirmation before sizing. First‑minute pops fade fast. Let VWAP hold and watch the tape before pressing.
            </div>
            <div className="mono" style={{ color: "var(--paper-55)", fontSize: "10px", marginTop: "14px" }}>— Rob, Pedro &amp; Buddy · The Editorial Desk</div>
          </div>
        </div>

        {/* ============== RIGHT RAIL ============== */}
        <aside className="rail">

          {/* LIVE WEBINAR */}
          <div className="panel dark">
            <div className="panel-head">
              <span>● LIVE · MORNING WEBINAR</span>
              <span className="right">DAY 217 · 9:42 ET</span>
            </div>
            <div className="video">
              <span className="live">● LIVE</span>
              <span className="viewers">1,284 watching</span>
              <div className="video-figure">
                <div className="speaker"></div>
              </div>
              <div className="lower3">
                <div className="who">Rob Booker<small>Walking the CUE tape</small></div>
                <div className="topic">CHAPTER 02<br />THE CUE SQUEEZE</div>
              </div>
            </div>
            <div className="video-controls">
              <span className="vc-icon">▶</span>
              <span className="vc-icon">⏸</span>
              <span>00:42:18</span>
              <div className="bar"></div>
              <span>LIVE</span>
              <span className="vc-icon">🔊</span>
              <span className="vc-icon">⛶</span>
            </div>
            {/* agenda */}
            <div className="agenda" style={{ background: "var(--ink)", color: "var(--paper)", borderTop: "1px solid var(--paper-18)" }}>
              <div className="agenda-row" style={{ borderColor: "var(--paper-18)" }}>
                <span className="t" style={{ color: "var(--paper-55)" }}>9:30</span>
                <span className="what" style={{ color: "var(--paper)" }}>Open recap &amp; tape read<em style={{ color: "var(--paper-55)" }}>SPY, sector flow, vol regime</em></span>
                <span className="badge" style={{ color: "var(--paper-55)" }}>DONE</span>
              </div>
              <div className="agenda-row" style={{ borderColor: "var(--paper-18)" }}>
                <span className="t now">9:42</span>
                <span className="what" style={{ color: "var(--paper)" }}>CUE walk‑through<em style={{ color: "var(--paper-55)" }}>PIPE math, 30‑day target ladder</em></span>
                <span className="badge live">● ON AIR</span>
              </div>
              <div className="agenda-row" style={{ borderColor: "var(--paper-18)" }}>
                <span className="t" style={{ color: "var(--paper-55)" }}>10:00</span>
                <span className="what" style={{ color: "var(--paper)" }}>ESPR / SOBR / LABT rapid‑fire<em style={{ color: "var(--paper-55)" }}>Catalyst, risk, levels</em></span>
                <span className="badge" style={{ color: "var(--paper-55)" }}>UP NEXT</span>
              </div>
              <div className="agenda-row" style={{ borderColor: "var(--paper-18)" }}>
                <span className="t" style={{ color: "var(--paper-55)" }}>10:25</span>
                <span className="what" style={{ color: "var(--paper)" }}>Q&amp;A — submit in chat<em style={{ color: "var(--paper-55)" }}>Members only</em></span>
                <span className="badge" style={{ color: "var(--paper-55)" }}>10:25</span>
              </div>
            </div>
          </div>

          {/* LIVE CHAT */}
          <div className="panel">
            <div className="panel-head">
              <span>● TRADING ROOM CHAT</span>
              <span className="right">412 ONLINE</span>
            </div>
            <div className="chat-body">
              <div className="msg"><span className="who mod">MOD · PEDRO</span>If you&apos;re new — pinned post has the CUE PIPE math walk‑through.</div>
              <div className="msg"><span className="who">@swing_dan</span>watching CUE for VWAP reclaim, $26.40 is the line</div>
              <div className="msg"><span className="who">@kayla.t</span>SOBR 0.82 → 0.91 in 30s. that float is a pinhead.</div>
              <div className="msg"><span className="who">@jmercer</span>ESPR deal spread 0.3% — anyone working a merger arb sleeve?</div>
              <div className="msg"><span className="who you">YOU</span>does the PIPE close before the next 8‑K?</div>
            </div>
            <div className="chat-input">
              <span>›</span>
              <input defaultValue="Type a message…" />
              <button>SEND</button>
            </div>
          </div>

          {/* ALERTS FEED */}
          <div className="panel dark">
            <div className="panel-head"><span>● ALERTS · YOUR WATCHLIST</span><span className="right">AUTO‑SCROLL</span></div>
            <div className="alerts">
              <div className="alert">
                <span className="t">9:41</span>
                <span className="body"><b>CUE</b> — VWAP reclaim on 220k print. <em>Tape read confirms.</em></span>
                <span className="pct">+114.9%</span>
              </div>
              <div className="alert">
                <span className="t">9:38</span>
                <span className="body"><b>ESPR</b> — definitive merger 8‑K hits the wire.</span>
                <span className="pct">+57.3%</span>
              </div>
              <div className="alert">
                <span className="t">9:35</span>
                <span className="body"><b>SOBR</b> — circuit breaker LULD halt, 5‑min pause.</span>
                <span className="pct">+55.0%</span>
              </div>
              <div className="alert">
                <span className="t">9:33</span>
                <span className="body"><b>LABT</b> — full float churned in opening 3 minutes.</span>
                <span className="pct">+48.1%</span>
              </div>
              <div className="alert">
                <span className="t">9:31</span>
                <span className="body"><b>AKAN</b> — opens above prior halt zone $58. <em>Watch $48 break.</em></span>
                <span className="pct">+27.4%</span>
              </div>
            </div>
            {/* mini pulse */}
            <div className="pulse">
              <div><div className="lbl">AVG MOVE</div><div className="v amb">+60.5%</div><div className="sub">across the board</div></div>
              <div><div className="lbl">TOP RUNNER</div><div className="v amb">CUE</div><div className="sub">+114.9% · 5.2M vol</div></div>
              <div><div className="lbl">TOTAL VOL</div><div className="v">111.4M</div><div className="sub">across these names</div></div>
              <div><div className="lbl">HALTS TODAY</div><div className="v">2</div><div className="sub">SOBR · AKAN</div></div>
            </div>
          </div>

          {/* EDITOR'S TAKE */}
          <div className="panel">
            <div className="panel-head"><span>→ EDITOR&apos;S TAKE</span><span className="right">9:40 ET</span></div>
            <div className="take">
              <div className="quote">&ldquo;The PIPE at $11 is gravity. Spot at $31 is opportunity. Don&apos;t confuse the two for one another — and never the second one for forever.&rdquo;</div>
              <div className="who">
                <span className="av">RB</span>
                <span><b>Rob Booker</b> · Editorial Desk · 22y trading</span>
              </div>
            </div>
          </div>

        </aside>
      </section>

      {/* =============== FOOT =============== */}
      <div className="foot">
        <span>⚠ NOT FINANCIAL ADVICE · ALL TRADING INVOLVES RISK · DATA DELAYED 0–15s · SESSION 05.01.2026</span>
        <span>LONGBOARD<em style={{ fontStyle: "italic", color: "var(--gold)", fontFamily: "Georgia,serif", fontWeight: 500 }}> AI</em> · COMMAND CENTER v3.2</span>
      </div>
    </div>
  );
}
