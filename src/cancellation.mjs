export const cancellationError=()=>new DOMException('Queue cancelled.','AbortError');
export function checkCancellation(signal){if(signal?.aborted)throw signal.reason||cancellationError();}
export function cancellable(operation,signal){
  checkCancellation(signal);
  if(!signal)return Promise.resolve().then(operation);
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason||cancellationError());
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(()=>{checkCancellation(signal);return operation();}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
