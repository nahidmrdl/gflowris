"""Check the full embedded editor and automatic return using private copies."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import threading
import urllib.request
import uuid

ROOT=Path(__file__).resolve().parents[1]
runtime=json.loads((ROOT/'.local'/'runtime.json').read_text(encoding='utf-8-sig'))
HOME=ROOT/'.local'/('embedded-check-'+uuid.uuid4().hex)
STATE=HOME/'state';STATE.mkdir(parents=True)
os.environ['CUTOUT_HOME']=str(HOME)
sys.path.insert(0,os.environ.get('CUTRIS_TEST_PACKAGE_ROOT',runtime['cutrisRoot']))
from app_paths import DATA_DIR
from PIL import Image,ImageDraw
from cutris.processing import finish_output
from cutris.projects import save_project
import cutris.runtime
cutris.runtime.user_state=lambda:HOME/'api'
fixture=Image.new('RGBA',(2048,2048),(0,0,0,0))
ImageDraw.Draw(fixture).rounded_rectangle((256,256,1791,1791),radius=128,fill='#9e83d6')
payload=io.BytesIO();fixture.save(payload,'PNG')
output,transform=finish_output(fixture)
project_id=save_project(payload.getvalue(),fixture,output,transform,name='synthetic-icon.png',quality='detail',mode='ai',notes=[])
exports=HOME/'exports';exports.mkdir()
original=exports/'synthetic-icon.png';original.write_bytes(payload.getvalue())
cutout=exports/'synthetic-icon-cutout.png';output.save(cutout)
file={'name':original.name,'path':str(original),'bytes':original.stat().st_size,'cutoutHistory':[],
      'cutout':{'name':cutout.name,'path':str(cutout),'bytes':cutout.stat().st_size,'width':output.width,'height':output.height,'projectId':project_id,'revision':0,'dataDir':str(DATA_DIR),'serviceDescriptor':str(DATA_DIR/'integration'/'service.json')}}
item={'id':str(uuid.uuid4()),'index':1,'prompt':'Synthetic icon','model':'Nano Banana 2.1','ratio':'1:1','count':1,'resolution':'2K','status':'complete','stage':'Saved','files':[file]}
saved={'status':'complete','items':[item],'current':None,'message':'Saved'}
(STATE/'last-queue.json').write_text(json.dumps(saved),encoding='utf-8')
(STATE/'settings.json').write_text(json.dumps({'outputFolder':str(exports)}),encoding='utf-8')
(STATE/'capabilities.json').write_bytes((Path(runtime['stateRoot'])/'capabilities.json').read_bytes())
(STATE/'runtime.json').write_text(json.dumps({**runtime,'cutrisRoot':str(HOME)}),encoding='utf-8')
child=subprocess.Popen([runtime['nodeExe'],str(ROOT/'src'/'server.mjs'),'--no-open'],cwd=ROOT,env={**os.environ,'FLOW_PROTO_STATE_DIR':str(STATE),'FLOW_PROTO_PORT':'4321'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
for attempt in range(150):
    try:
        control=json.loads((STATE/'control.json').read_text());break
    except (OSError,ValueError):time.sleep(.1)
else:raise RuntimeError('Fixture companion failed to start.')

def workspace_state():
    request=urllib.request.Request(control['origin']+'/api/state',headers={'Authorization':'Bearer '+control['token']})
    with urllib.request.urlopen(request) as response:return json.load(response)

spec=importlib.util.spec_from_file_location('gflowris_shell',ROOT/'desktop.py')
shell=importlib.util.module_from_spec(spec);spec.loader.exec_module(shell)
shell.STATE=STATE
bridge=shell.DesktopBridge(runtime);bridge._control=lambda:control
import webview
window=webview.create_window('gflowris embedded verification',control['origin']+'/?desktop=1#key='+control['token'],js_api=bridge,width=1280,height=800,min_size=(900,620))
bridge._window=window;bridge._ensure_service()
report={'ok':False,'checks':{}}
heartbeat_stopped=threading.Event()
def heartbeat(closed=False):
    request=urllib.request.Request(control['origin']+'/api/desktop/heartbeat',data=json.dumps({'closed':closed}).encode(),headers={'Authorization':'Bearer '+control['token'],'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=2):pass
def pulse():
    heartbeat()
    while not heartbeat_stopped.wait(1):heartbeat()
heartbeat_thread=threading.Thread(target=pulse,daemon=True);heartbeat_thread.start()


def wait(callback,timeout=25):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        try:
            if callback():return
        except Exception:pass
        time.sleep(.1)
    raise RuntimeError('Embedded renderer check timed out.')

def run():
    stage='queue'
    try:
        wait(lambda:window.evaluate_js("Boolean(document.querySelector('.edit-button') && window.pywebview?.api?.open_editor)"))
        window.evaluate_js("document.querySelector('[data-workspace-tab=images]').click()")
        wait(lambda:window.evaluate_js("document.querySelector('.image-card img')?.naturalWidth===1536"))
        report['checks']['main_quality_visible']=window.evaluate_js("document.querySelector('#cutris-quality').getBoundingClientRect().bottom < innerHeight")
        window.evaluate_js("document.querySelector('.edit-button').click()")
        stage='embedded editor'
        wait(lambda:window.evaluate_js("Boolean(typeof state!=='undefined' && state.job && state.original && state.automatic && document.querySelector('#returnToWorkspace') && !$('returnToWorkspace').hidden)"))
        report['checks']['same_window']=len(webview.windows)==1
        report['checks']['editor_startup_has_no_bridge_error']=window.evaluate_js("!$('notice').textContent.includes('is not a function')")
        report['checks']['whole_cutris_present']=window.evaluate_js("['eraseTool','restoreTool','wandTool','geometryButton','modelsButton','appSettingsButton','historyButton','download','zip'].every(id=>!!document.getElementById(id))")
        window.resize(1024,720)
        time.sleep(.2)
        report['checks']['embedded_actions_fit_laptop']=window.evaluate_js("['returnToWorkspace','download','save','geometryButton'].every(id=>{const r=$(id).getBoundingClientRect();return r.bottom<=innerHeight && r.right<=innerWidth})")
        window.resize(1280,800)
        report['checks']['native_folder_picker']=window.evaluate_js("typeof window.pywebview.api.choose_output_folder==='function'")
        report['checks']['full_original_mask']=window.evaluate_js('state.original.naturalWidth===state.automatic.naturalWidth && state.original.naturalHeight===state.automatic.naturalHeight')
        manifest=DATA_DIR/'jobs'/project_id/'manifest.json';job=json.loads(manifest.read_text());source=manifest.parent/job['items'][0]['id']/'original.png';before=hashlib.sha256(source.read_bytes()).hexdigest()
        window.evaluate_js("state.strokes.push({mode:'erase',size:32,points:[[900,900]]});state.dirty=true;renderCanvas();updateTools()")
        wait(lambda:window.confirm_close)
        report['checks']['unsaved_edits_protect_close']=True
        window.evaluate_js("$('save').click()")
        wait(lambda:window.evaluate_js('!state.busy && !state.dirty && currentItem().revision===1'))
        stage='automatic saved-edit sync'
        wait(lambda:workspace_state()['queue']['items'][0]['files'][0]['cutout'].get('revision')==1)
        report['checks']['save_syncs_automatically']=True
        previous=workspace_state()['queue']['items'][0]['files'][0]['cutout']['path']
        window.evaluate_js("state.strokes.push({mode:'erase',size:32,points:[[950,950]]});state.dirty=true;renderCanvas();updateTools();$('returnToWorkspace').click()")
        stage='save and return'
        wait(lambda:window.evaluate_js("Boolean(document.querySelector('#jobs .edit-button'))"))
        latest=workspace_state()['queue']['items'][0]['files'][0]
        report['checks']['save_and_return']=latest['cutout']['revision']==2
        report['checks']['saved_return_clears_close_guard']=not window.confirm_close
        report['checks']['new_png_saved']=latest['cutout']['path']!=previous and Path(previous).is_file()
        report['checks']['earlier_exports_preserved']=len(latest.get('cutoutHistory',[]))==2
        report['checks']['original_preserved']=hashlib.sha256(source.read_bytes()).hexdigest()==before
        wait(lambda:window.evaluate_js("document.querySelector('.image-card img')?.complete && document.querySelector('.image-card img')?.naturalWidth===1536"))
        report['checks']['saved_brush_pixels_visible']=window.evaluate_js("(() => {const c=document.createElement('canvas');c.width=c.height=1536;c.getContext('2d').drawImage(document.querySelector('.image-card img'),0,0);return c.getContext('2d').getImageData(694,694,1,1).data[3]===0;})()")
        stage='cropped PNG return'
        window.evaluate_js("document.querySelector('.edit-button').click()")
        wait(lambda:window.evaluate_js("typeof state!=='undefined' && Boolean(state.automatic)"))
        window.evaluate_js("$('geometryButton').click()")
        wait(lambda:window.evaluate_js("$('geometryDialog').open"))
        window.evaluate_js("(() => {for(const [id,value] of Object.entries({geometryCropX:400,geometryCropY:400,geometryCropWidth:1000,geometryCropHeight:800}))$(id).value=value;$('geometryCropWidth').dispatchEvent(new Event('input',{bubbles:true}));$('geometryApply').click();})()")
        wait(lambda:window.evaluate_js("!$('geometryDialog').open && !state.busy && currentItem().revision===3"))
        window.evaluate_js("$('returnToWorkspace').click()")
        wait(lambda:window.evaluate_js("document.querySelector('.image-card img')?.naturalWidth===1000 && document.querySelector('.image-card img')?.naturalHeight===800"))
        report['checks']['cropped_png_visible_after_return']=True
        latest=workspace_state()['queue']['items'][0]['files'][0]['cutout']
        with Image.open(latest['path']) as image:report['checks']['crop_export_matches_preview']=image.size==(1000,800)
        window.evaluate_js("document.querySelector('.image-card img').click()")
        wait(lambda:window.evaluate_js("document.querySelector('#preview-image')?.naturalWidth===1000"))
        report['checks']['full_preview_uses_latest_crop']=window.evaluate_js("document.querySelector('#preview-image').naturalHeight===800")
        window.evaluate_js("document.querySelector('#preview-close').click()")
        window.evaluate_js("document.querySelector('#launch-cutris').click()")
        wait(lambda:window.evaluate_js("Boolean(document.querySelector('#appSettingsButton') && window.pywebview?.api?.integration_context)"))
        window.evaluate_js("$('appSettingsButton').click()")
        wait(lambda:window.evaluate_js("$('appSettingsDialog').open"))
        report['checks']['full_settings_available']=window.evaluate_js("['prefBrowse','prefQuality','prefMode','prefBackground','prefIntegration'].every(id=>!!document.getElementById(id))")
        report['checks']['managed_integration']=window.evaluate_js("$('prefIntegration').disabled && $('integrationState').textContent==='Connected inside gflowris'")
        report['ok']=all(report['checks'].values())
    except Exception as error:report.update(stage=stage,error=str(error))
    finally:
        window.confirm_close=False;window.destroy()

try:webview.start(run,gui='edgechromium',private_mode=True,storage_path=str(HOME/'webview'),icon=str(ROOT/'assets'/'app.ico'))
finally:
    heartbeat_stopped.set();heartbeat_thread.join(timeout=3);heartbeat(closed=True)
    bridge.close();child.terminate();child.wait(timeout=10)
destination=Path(runtime['stateRoot'])/'TestRuns'/'embedded-check.json';destination.parent.mkdir(exist_ok=True,parents=True);destination.write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report));raise SystemExit(0 if report['ok'] else 1)
