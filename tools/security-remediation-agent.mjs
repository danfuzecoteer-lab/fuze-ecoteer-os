const base=String(process.env.SUPABASE_URL||"").replace(/\/$/,""), key=process.env.SUPABASE_SERVICE_ROLE_KEY, token=process.env.GITHUB_TOKEN, repo=process.env.GITHUB_REPOSITORY||"danfuzecoteer-lab/fuze-ecoteer-os";
if(!base||!key||!token) throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and GITHUB_TOKEN are required.");
const db={apikey:key,Authorization:`Bearer ${key}`}, gh={Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"};
const response=await fetch(`${base}/rest/v1/security_findings?status=in.(open,in_progress)&select=*&order=created_at.asc`,{headers:db});
if(!response.ok) throw new Error(`Unable to read findings: ${response.status}`);
const findings=await response.json(), runId=`remediation-${Date.now()}`;
const safe=findings.filter(f=>/missing security header|exposed sensitive route or file/i.test(f.title||"")), blocked=findings.filter(f=>!safe.includes(f));
let prUrl=null;
if(safe.length){
 const ref=await (await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/main`,{headers:gh})).json(), branch=`security/remediation-${Date.now()}`;
 const made=await fetch(`https://api.github.com/repos/${repo}/git/refs`,{method:"POST",headers:gh,body:JSON.stringify({ref:`refs/heads/${branch}`,sha:ref.object.sha})});
 if(!made.ok) throw new Error(`Unable to create branch: ${made.status}`);
 const file=await get(".vercelignore",branch), lines=file.content.split(/\r?\n/).filter(Boolean);
 for(const f of safe) if(/exposed sensitive route/i.test(f.title||"")&&String(f.route||"").endsWith(".csv")){const entry=String(f.route).replace(/^\//,"");if(!lines.includes(entry))lines.push(entry);}
 const updated=await fetch(`https://api.github.com/repos/${repo}/contents/.vercelignore`,{method:"PUT",headers:gh,body:JSON.stringify({message:"security: block exposed static data",content:Buffer.from(lines.join("\n")+"\n").toString("base64"),branch,sha:file.sha})});
 if(!updated.ok) throw new Error(`Unable to update .vercelignore: ${updated.status}`);
 const pr=await fetch(`https://api.github.com/repos/${repo}/pulls`,{method:"POST",headers:gh,body:JSON.stringify({title:"Automated security hardening",head:branch,base:"main",draft:true,body:`Automated low-risk hardening for ${safe.length} findings. High-risk findings remain approval-gated.\n\n${safe.map(f=>`- ${f.title}: ${f.route||"/"}`).join("\n")}`})});
 if(!pr.ok)throw new Error(`Unable to create PR: ${pr.status}`); prUrl=(await pr.json()).html_url;
}
const saved=await fetch(`${base}/rest/v1/security_remediation_runs`,{method:"POST",headers:{...db,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify({run_id:runId,status:"completed",summary:{findings:findings.length,auto_fixed:safe.length,approval_required:blocked.length},pull_requests:prUrl?[prUrl]:[]})});
if(!saved.ok)throw new Error(`Unable to save remediation run: ${saved.status}`);
console.log(JSON.stringify({runId,findings:findings.length,autoFixed:safe.length,approvalRequired:blocked.length,pullRequest:prUrl}));
async function get(path,ref){const r=await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,{headers:gh});if(!r.ok)throw new Error(`Unable to read ${path}: ${r.status}`);const d=await r.json();return{sha:d.sha,content:Buffer.from(d.content.replace(/\\n/g,""),"base64").toString("utf8")};}