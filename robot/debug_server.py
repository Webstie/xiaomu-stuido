"""Live debug dashboard for the robot runtime.

A tiny stdlib HTTP + SSE server (no deps) that the runtime pushes events to:
state changes, button presses, what the child said (STT), what the robot says
(TTS), activity progress, safety hits, and raw chat-turn debug. Open
http://<pi-ip>:8788/ in a browser on the same network.

Usage from main.py:
    import debug_server as dbg
    dbg.start()                      # once, at startup
    dbg.set_state(state="IDLE")      # update the status badges
    dbg.emit("user", text="你好")    # log an event (kinds below)
"""
from __future__ import annotations

import json
import queue
import threading
import time
from urllib.parse import urlparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_lock = threading.Lock()
_subscribers: list[queue.Queue] = []
_commands: queue.Queue = queue.Queue()
_state: dict = {"state": "?", "step": "none", "activity": None, "age": None, "voice": None}
_history: list[dict] = []
_MAX_HISTORY = 300


def _ts() -> str:
    return time.strftime("%H:%M:%S")


def emit(kind: str, **data) -> None:
    """kind ∈ button|user|robot|safety|activity|info|debug|state."""
    ev = {"ts": _ts(), "kind": kind, **data}
    with _lock:
        _history.append(ev)
        if len(_history) > _MAX_HISTORY:
            _history.pop(0)
        subs = list(_subscribers)
    for q in subs:
        try:
            q.put_nowait(ev)
        except Exception:
            pass


def set_state(**kw) -> None:
    with _lock:
        _state.update({k: v for k, v in kw.items() if v is not None or k == "activity"})
        snap = dict(_state)
    emit("state", **snap)


def poll_commands() -> list[dict]:
    """Return pending remote dashboard commands without blocking the robot loop."""
    out: list[dict] = []
    while True:
        try:
            out.append(_commands.get_nowait())
        except queue.Empty:
            return out


_HTML = """<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>小沐 · Robot Debug</title>
<style>
:root{--bg:#0d0b12;--panel:#16131d;--line:#272233;--dim:#7a7488;--txt:#e8e6ef}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);
font:14px/1.5 -apple-system,Segoe UI,Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
header{padding:14px 18px;border-bottom:1px solid var(--line);display:flex;gap:14px;align-items:center;flex-wrap:wrap}
header h1{font-size:16px;margin:0;font-weight:700}
.badge{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px 12px}
.badge b{color:var(--dim);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.5px;display:block}
.badge span{font-size:16px;font-weight:600}
#state span{color:#f5a623}#dot{width:9px;height:9px;border-radius:50%;background:#e05050;display:inline-block;margin-left:auto}
#dot.on{background:#3ddc84}
#remote{max-width:1100px;margin:12px auto 0;padding:0 18px;display:flex;gap:8px;align-items:center}
#remote input{flex:1;min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:10px 12px;font:inherit;outline:none}
#remote input:focus{border-color:#8b5cf6}
#remote button{border:1px solid var(--line);border-radius:8px;background:#241b33;color:var(--txt);padding:10px 12px;font:inherit;font-weight:700;cursor:pointer}
#remote button:hover{background:#302246}
#remote button.primary{background:#3b2569;border-color:#6d48b5}
#remote button.danger{background:#351719;border-color:#6b2b31}
#log{padding:10px 18px;max-width:1100px;margin:0 auto}
.row{display:flex;gap:10px;padding:7px 12px;border-radius:8px;margin:3px 0;align-items:baseline;animation:f .2s}
@keyframes f{from{opacity:0;transform:translateY(4px)}}
.row .t{color:var(--dim);font-variant-numeric:tabular-nums;font-size:12px;flex:none;width:62px}
.row .k{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;flex:none;width:64px;text-align:right}
.row .m{flex:1;white-space:pre-wrap;word-break:break-word}
.button{background:#10243a}.button .k{color:#4ea3ff}
.user{background:#0e2a18}.user .k{color:#3ddc84}.user .m{font-weight:600}
.robot{background:#1e1430}.robot .k{color:#b98cff}.robot .m{font-weight:600}
.safety{background:#3a1010}.safety .k{color:#ff5a5a}.safety .m{font-weight:700}
.activity{background:#2a2008}.activity .k{color:#f5a623}
.info .k{color:var(--dim)}.info{opacity:.85}
.debug .k{color:#8a7a3a}.debug{opacity:.7;font-size:12px}
.state{display:none}
</style></head><body>
<header>
 <h1>小沐 · Robot Debug</h1>
 <div class="badge" id="state"><b>State</b><span>—</span></div>
 <div class="badge"><b>Step</b><span id="step">—</span></div>
 <div class="badge"><b>Activity</b><span id="activity">—</span></div>
 <div class="badge"><b>Age</b><span id="age">—</span></div>
 <div class="badge"><b>Voice</b><span id="voice" style="font-size:12px">—</span></div>
 <span id="dot" title="connection"></span>
</header>
<form id="remote">
 <button type="button" data-action="start">开始</button>
 <input id="remoteText" autocomplete="off" placeholder="远程输入孩子的话，回车发送给小沐">
 <button class="primary" type="submit">发送</button>
 <button class="danger" type="button" data-action="end">结束</button>
</form>
<div id="log"></div>
<script>
const log=document.getElementById('log'),dot=document.getElementById('dot');
const labels={button:'按键',user:'听到',robot:'说',safety:'安全',activity:'活动',info:'',debug:'dbg'};
async function command(body){
 await fetch('/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}
document.getElementById('remote').addEventListener('submit',async ev=>{
 ev.preventDefault();
 const input=document.getElementById('remoteText');
 const text=input.value.trim();
 if(!text)return;
 input.value='';
 await command({action:'message',text});
});
document.querySelectorAll('#remote button[data-action]').forEach(btn=>{
 btn.addEventListener('click',()=>command({action:btn.dataset.action}));
});
function setState(s){
 document.querySelector('#state span').textContent=s.state||'—';
 document.getElementById('step').textContent=s.step||'—';
 document.getElementById('activity').textContent=(s.activity&&s.activity.id)||(s.activity)||'—';
 document.getElementById('age').textContent=s.age||'—';
 document.getElementById('voice').textContent=s.voice||'—';
}
function add(e){
 if(e.kind==='state'){setState(e);return;}
 const r=document.createElement('div');r.className='row '+e.kind;
 let m=e.text!==undefined?e.text:(e.key!==undefined?e.key:(e.msg!==undefined?e.msg:JSON.stringify(e)));
 r.innerHTML='<span class="t"></span><span class="k"></span><span class="m"></span>';
 r.querySelector('.t').textContent=e.ts||'';
 r.querySelector('.k').textContent=labels[e.kind]!==undefined?labels[e.kind]:e.kind;
 r.querySelector('.m').textContent=m;
 const near=log.scrollHeight-window.scrollY-window.innerHeight<120;
 log.appendChild(r);
 while(log.children.length>400)log.removeChild(log.firstChild);
 if(near)window.scrollTo(0,document.body.scrollHeight);
}
function connect(){
 const es=new EventSource('/events');
 es.onopen=()=>dot.classList.add('on');
 es.onerror=()=>{dot.classList.remove('on');es.close();setTimeout(connect,1500);};
 es.onmessage=ev=>{try{add(JSON.parse(ev.data));}catch(e){}};
}
connect();
</script></body></html>"""


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # silence
        pass

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/" or parsed.path.startswith("/index"):
            body = _HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif parsed.path == "/snapshot":
            with _lock:
                body = json.dumps(
                    {"state": _state, "history": _history[-80:]}, ensure_ascii=False
                ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif parsed.path == "/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            q: queue.Queue = queue.Queue(maxsize=2000)
            with _lock:
                _subscribers.append(q)
                snap = dict(_state)
                hist = list(_history[-80:])
            try:
                self._sse({"kind": "state", **snap})
                for ev in hist:
                    self._sse(ev)
                while True:
                    self._sse(q.get())
            except Exception:
                pass
            finally:
                with _lock:
                    if q in _subscribers:
                        _subscribers.remove(q)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/clear-history":
            with _lock:
                _history.clear()
            body = b'{"ok":true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path != "/command":
            self.send_response(404)
            self.end_headers()
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(min(length, 8192))
            data = json.loads(raw.decode("utf-8") or "{}")
            action = data.get("action")
            text = (data.get("text") or "").strip()
            if action not in {"start", "end", "message"}:
                raise ValueError("bad action")
            if action == "message" and not text:
                raise ValueError("empty message")
            cmd = {"action": action, "text": text, "ts": _ts()}
            _commands.put_nowait(cmd)
            emit("debug", msg=f"remote command: {action}" + (f" «{text[:30]}»" if text else ""))
            body = b'{"ok":true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            body = json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False).encode("utf-8")
            self.send_response(400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def _sse(self, obj: dict) -> None:
        self.wfile.write(("data: " + json.dumps(obj, ensure_ascii=False) + "\n\n").encode("utf-8"))
        self.wfile.flush()


def start(port: int = 8788) -> None:
    try:
        srv = ThreadingHTTPServer(("0.0.0.0", port), _Handler)
    except OSError as e:
        print("debug server failed to bind:", e, flush=True)
        return
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"debug dashboard on http://0.0.0.0:{port}/", flush=True)
