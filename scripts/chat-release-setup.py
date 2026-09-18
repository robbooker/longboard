#!/usr/bin/env python3
"""Store dedicated release credentials directly in GitHub, never on disk or argv."""
import getpass
import json
import subprocess
import sys

REPO = 'robbooker/longboard'
ENVIRONMENT = 'longboard-release'

def gh(*args, body=None):
    result = subprocess.run(['gh', *args], input=body, text=True, capture_output=True)
    if result.returncode:
        # Avoid printing credential-bearing subprocess output.
        raise SystemExit('GitHub setup failed. Check gh authentication and repository administration access.')
    return result.stdout

if not sys.stdin.isatty():
    raise SystemExit('Run this script directly in your terminal; do not pipe it into Python.')
print('Store dedicated GitHub, Supabase and Vercel release tokens in GitHub encrypted environment secrets.')
print('This does not enable publishing or change branch protection.')
# Environment secrets must be available only on main, never PR or arbitrary branches.
environments=json.loads(gh('api',f'repos/{REPO}/environments?per_page=100'))
existing=next((item for item in environments.get('environments',[]) if item['name']==ENVIRONMENT),None)
if existing:
    policy=existing.get('deployment_branch_policy') or {}
    if not policy.get('custom_branch_policies') or policy.get('protected_branches'):
        raise SystemExit('Existing release environment must be restricted to the main branch. No settings changed.')
else:
    gh('api', '--method', 'PUT', f'repos/{REPO}/environments/{ENVIRONMENT}', '--input', '-',
       body=json.dumps({'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True}}))
policies=json.loads(gh('api',f'repos/{REPO}/environments/{ENVIRONMENT}/deployment-branch-policies'))
if any(p['name'] != 'main' or p.get('type','branch') != 'branch' for p in policies.get('branch_policies', [])):
    raise SystemExit('Environment has additional allowed branches. Restrict it to main before adding release secrets.')
if not policies.get('branch_policies'):
    gh('api','--method','POST',f'repos/{REPO}/environments/{ENVIRONMENT}/deployment-branch-policies','--input','-',body=json.dumps({'name':'main','type':'branch'}))
for name, label in [('LONGBOARD_RELEASE_GITHUB_TOKEN','Dedicated GitHub token restricted to robbooker/longboard'),('SUPABASE_RELEASE_TOKEN','Dedicated Supabase management token'),('VERCEL_RELEASE_TOKEN','Dedicated Vercel token for the Longboard team')]:
    token=getpass.getpass(f'{label} (hidden): ').strip()
    if not token:
        raise SystemExit('Empty token; stopped. Publishing remains disabled.')
    gh('secret','set',name,'--repo',REPO,'--env',ENVIRONMENT,body=token)
    token=None
    print(f'Saved {name} to GitHub encrypted environment secrets.')
print('Credentials saved. Publishing remains disabled until rollout checks and activation.')
