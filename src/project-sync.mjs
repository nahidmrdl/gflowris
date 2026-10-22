// Export only newly saved editor revisions; never replace the original image.
export async function syncSavedEdits(queue,client,{projectId=null}={}){
  const updates=[];
  for(const item of queue.items)for(const [index,file]of(item.files||[]).entries()){
    const cutout=file.cutout;if(!cutout?.projectId||projectId&&cutout.projectId!==projectId)continue;
    try{
      const saved=await client.projectState(cutout);
      delete file.syncError;
      if(saved.revision<=(cutout.revision||0))continue;
      const result=await client.refresh(cutout,{allowStart:false});
      file.cutoutHistory=[...(file.cutoutHistory||[]),cutout];file.cutout=result;
      delete file.syncError;updates.push({item:item.id,index,revision:result.revision});
    }catch(error){file.syncError='Saved edits have not synced yet. '+error.message;if(projectId)throw error;}
  }
  return updates;
}
