import path from 'node:path';
import {promptOptions} from '../public/prompt-input.js';
export const DEFAULT_PREFERENCES={defaults:{model:'',ratio:'1:1',count:1,resolution:'2K',removeBackground:false,cutrisQuality:'detail',cutrisMode:'ai',autoCrop:true},draft:''};
export function validatePreferences(update,current){
  if(!update||typeof update!=='object'||Array.isArray(update)||Object.keys(update).some(key=>!['outputFolder','defaults','draft','inputMode','composerDefaults','editingId'].includes(key)))throw new Error('Unknown workspace setting.');
  const result={...current};
  if('outputFolder'in update){if(typeof update.outputFolder!=='string'||!path.isAbsolute(update.outputFolder)||update.outputFolder.length>4096||/[\x00-\x1F]/.test(update.outputFolder))throw new Error('Choose an absolute output folder.');result.outputFolder=path.resolve(update.outputFolder);}
  if('draft'in update){if(typeof update.draft!=='string'||update.draft.length>150000)throw new Error('The draft is too large.');result.draft=update.draft;}
  if('inputMode'in update){if(!['single','bulk','json'].includes(update.inputMode))throw new Error('Choose an input mode.');result.inputMode=update.inputMode;}
  if('composerDefaults'in update)result.composerDefaults=promptOptions(update.composerDefaults);
  if('editingId'in update){if(update.editingId!==null&&!/^[0-9a-f-]{36}$/.test(update.editingId))throw new Error('Choose a queued prompt.');result.editingId=update.editingId;}
  if('defaults'in update){
    const values=update.defaults;
    if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(key=>!(key in DEFAULT_PREFERENCES.defaults)))throw new Error('Unknown generation setting.');
    const defaults={...DEFAULT_PREFERENCES.defaults,...current.defaults,...values};
    for(const field of ['model','ratio','resolution'])if(typeof defaults[field]!=='string'||defaults[field].length>100)throw new Error('Invalid generation setting.');
    if(!Number.isInteger(defaults.count)||defaults.count<1||defaults.count>4||!['detail','fast'].includes(defaults.cutrisQuality)||!['ai','white'].includes(defaults.cutrisMode)||typeof defaults.removeBackground!=='boolean'||typeof defaults.autoCrop!=='boolean')throw new Error('Invalid processing setting.');
    result.defaults=defaults;
  }
  return result;
}
