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
    if(this.state.status==='running'&&current&&!this.pauseRequested){
      this.state.message=`Prompt ${current.index} of ${this.state.items.length}: ${current.stage}`;
      if(this.state.background?.pending)this.state.message+=` · Background removal: ${this.state.background.pending} remaining.`;
    }
    this.onChange(structuredClone(this.state));
  }
  async start(items){
    if(this.running)throw new Error('The current queue is still running.');
    this.pauseRequested=false;this.state={status:'running',items,current:null,background:{pending:0,current:null},message:'Starting queue.'};this.changed();
    this.controller=new AbortController();this.running=this.process(this.controller.signal).finally(()=>{this.running=null;});return this.running;
  }
  pause(){this.pauseRequested=true;this.state.message='Pausing after current downloads and pending background removal finish.';this.changed();}
  cancel(force=false){
    if(!force&&!this.running&&this.state.status!=='paused')return false;
    this.controller?.abort(cancellationError());this.pauseRequested=false;
    for(const item of this.state.items)if(['queued','running'].includes(item.status)){item.status='cancelled';item.stage='Cancelled';item.cancelledAt=new Date(this.clock()).toISOString();}
    this.state.status='cancelled';this.state.current=null;this.state.background={pending:0,current:null};this.state.message='Queue cancelled. Saved files are kept. An image already submitted to Flow may still finish there.';this.changed();return true;
  }
  async resume(){
    if(this.running||this.state.status!=='paused')throw new Error('This queue cannot be resumed.');
    this.pauseRequested=false;this.state.status='running';this.changed();
    this.controller=new AbortController();this.running=this.process(this.controller.signal).finally(()=>{this.running=null;});return this.running;
  }
  async process(signal){
    let item,browserFailure=null,cutrisFailure=null,flowActive=true,processing=Promise.resolve();
    this.state.background={pending:0,current:null};
    const finishItem=prompt=>{
      if(signal.aborted)return;
      const failed=prompt.files.find(file=>file.cutrisError);
      if(failed){prompt.status='attention';prompt.stage='The original is saved. Cutris: '+failed.cutrisError;}
      else{prompt.status='complete';prompt.finishedAt=new Date(this.clock()).toISOString();prompt.stage='Saved';}
      this.changed();
    };
    const enqueueCutout=(saved,prompt,index,total)=>{
      this.state.background.pending++;
      processing=processing.then(async()=>{
        if(signal.aborted)return;
        this.state.background.current=prompt.id;prompt.backgroundStage=`Removing background ${index+1} of ${total}`;
        if(prompt.downloadsFinishedAt&&prompt.status!=='attention')prompt.stage=prompt.backgroundStage;
        if(!flowActive)this.state.current=prompt.id;
        this.changed();
        try{const cutout=await cancellable(()=>this.driver.postprocess(saved,prompt,{signal}),signal);checkCancellation(signal);saved.cutout=cutout;}
        catch(error){
          if(signal.aborted)return;
          saved.cutrisError=error.message;prompt.status='attention';prompt.stage='The original is saved. Cutris: '+error.message;
          cutrisFailure??={item:prompt,message:prompt.stage};
        }finally{
          if(!signal.aborted){this.state.background.pending--;this.state.background.current=null;delete prompt.backgroundStage;this.changed();}
        }
      });
      this.changed();
    };
    try{
      for(const prompt of this.state.items.filter(value=>value.status==='queued')){
        checkCancellation(signal);
        if(this.pauseRequested||cutrisFailure)break;
        item=prompt;
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
          if(item.status!=='attention')item.stage=`Saving image ${index+1} of ${assets.length}`;this.changed();
          const saved=await cancellable(()=>this.driver.download(assets[index],item,index,{signal}),signal);
          item.files.push(saved);this.changed();
          if(item.removeBackground)enqueueCutout(saved,prompt,index,assets.length);
        }
        item.downloadsFinishedAt=new Date(this.clock()).toISOString();
        if(item.removeBackground){
          if(item.status!=='attention')item.stage=item.backgroundStage||'Waiting for background removal';
          processing=processing.then(()=>finishItem(prompt));this.changed();
        }else finishItem(prompt);
      }
    }catch(error){
      if(!signal.aborted){
        browserFailure={item,message:error.message};
        if(item){item.status='attention';item.stage=error.message;}
        this.changed();
      }
    }
    flowActive=false;
    if(!signal.aborted){
      this.state.current=this.state.background.current||this.state.items.find(prompt=>prompt.status==='running')?.id||null;
      this.changed();
    }
    await processing;
    if(signal.aborted)return;
    const failure=browserFailure||cutrisFailure;
    this.state.current=null;
    if(failure){this.state.status='attention';this.state.message=failure.message+' The queue has stopped; it will not retry automatically.';}
    else if(this.pauseRequested&&this.state.items.some(prompt=>prompt.status==='queued')){this.state.status='paused';this.state.message='Paused. Resume to continue with the next prompt.';}
    else{this.state.status='complete';this.state.message='All images have been saved.';}
    this.changed();
  }
}
