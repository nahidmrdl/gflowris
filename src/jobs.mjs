import {randomUUID} from 'node:crypto';
import {parsePromptInput} from '../public/prompt-input.js';
import {cancellable,cancellationError,checkCancellation} from './cancellation.mjs';

export function parsePrompts(source,defaults={},mode='auto'){
  return parsePromptInput(source,defaults,mode).map((entry,index)=>({id:randomUUID(),index:index+1,...entry,status:'queued',stage:'Queued',files:[]}));
}

export class ImageQueue{
  constructor(driver,{onChange=()=>{},clock=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),generationTimeout=15*60*1000,pollInterval=1800}={}){
    this.driver=driver;this.onChange=onChange;this.clock=clock;this.sleep=sleep;this.generationTimeout=generationTimeout;this.pollInterval=pollInterval;
    this.state={status:'idle',items:[],current:null,message:'Ready for a queue.'};this.pauseRequested=false;this.running=null;
  }
  changed(){
    const current=this.state.items.find(item=>item.id===this.state.current);
    if(this.state.status==='running'&&current&&!this.pauseRequested)this.state.message=`Prompt ${current.index} of ${this.state.items.length}: ${current.stage}`;
    this.onChange(structuredClone(this.state));
  }
  async start(items){
    if(this.running)throw new Error('The current queue is still running.');
    this.pauseRequested=false;this.state={status:'running',items,current:null,message:'Starting queue.'};this.changed();
    this.controller=new AbortController();this.running=this.process(this.controller.signal).finally(()=>{this.running=null;});return this.running;
  }
  pause(){this.pauseRequested=true;this.state.message='Pausing after the current prompt finishes saving.';this.changed();}
  cancel(force=false){
    if(!force&&!this.running&&this.state.status!=='paused')return false;
    this.controller?.abort(cancellationError());this.pauseRequested=false;
    for(const item of this.state.items)if(['queued','running'].includes(item.status)){item.status='cancelled';item.stage='Cancelled';item.cancelledAt=new Date(this.clock()).toISOString();}
    this.state.status='cancelled';this.state.current=null;this.state.message='Queue cancelled. Saved files are kept. An image already submitted to Flow may still finish there.';this.changed();return true;
  }
  async resume(){
    if(this.running||this.state.status!=='paused')throw new Error('This queue cannot be resumed.');
    this.pauseRequested=false;this.state.status='running';this.changed();
    this.controller=new AbortController();this.running=this.process(this.controller.signal).finally(()=>{this.running=null;});return this.running;
  }
  async process(signal){
    let item;
    try{
      for(item of this.state.items.filter(i=>i.status==='queued')){
        checkCancellation(signal);
        if(this.pauseRequested){this.state.status='paused';this.state.message='Paused. Resume to continue with the next prompt.';this.changed();return;}
        this.state.current=item.id;item.status='running';item.startedAt=new Date(this.clock()).toISOString();item.stage='Setting up Flow';this.changed();
        // A driver must never retry a generation click after an ambiguous response.
        const ticket=await cancellable(()=>this.driver.generate(item,{signal}),signal);
        item.generationStartedAt=new Date(this.clock()).toISOString();item.stage='Generating images';this.changed();
        const deadline=this.clock()+this.generationTimeout;
        let assets;
        while(true){
          const result=await cancellable(()=>this.driver.generation(ticket,item,{signal}),signal);
          if(result.error)throw new Error(result.error);
          if(result.complete){assets=result.assets;if(!Array.isArray(assets)||assets.length!==item.count)throw new Error('Flow did not return the requested number of new images. Review the project before retrying.');break;}
          if(this.clock()>deadline)throw new Error('Generation timed out. Check Flow before starting another queue; no prompt was resubmitted.');
          await cancellable(()=>this.sleep(this.pollInterval),signal);
        }
        item.generationFinishedAt=new Date(this.clock()).toISOString();
        for(let index=0;index<assets.length;index++){
          item.stage=`Saving image ${index+1} of ${assets.length}`;this.changed();
          const saved=await cancellable(()=>this.driver.download(assets[index],item,index,{signal}),signal);
          item.files.push(saved);this.changed();
          if(item.removeBackground){
            item.stage=`Removing background ${index+1} of ${assets.length}`;this.changed();
            try{saved.cutout=await cancellable(()=>this.driver.postprocess(saved,item,{signal}),signal);this.changed();}
            catch(error){if(signal.aborted)throw error;saved.cutrisError=error.message;this.changed();throw new Error('The original is saved. Cutris: '+error.message);}
          }
        }
        item.status='complete';item.finishedAt=new Date(this.clock()).toISOString();item.stage='Saved';this.changed();
      }
      this.state.status='complete';this.state.current=null;this.state.message='All images have been saved.';this.changed();
    }catch(error){
      if(signal.aborted)return;
      if(item){item.status='attention';item.stage=error.message;}
      this.state.status='attention';this.state.message=error.message+' The queue has stopped; it will not retry automatically.';this.changed();
    }
  }
}
