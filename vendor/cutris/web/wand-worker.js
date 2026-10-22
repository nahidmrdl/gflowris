'use strict';
// Four-connected flood fill using a FIXED seed color, not neighbor-to-neighbor
// color drift. Transparent pixels are barriers. Runs off the UI thread.
self.onmessage = ({data:{buffer,width,height,x,y,tolerance}}) => {
  try {
    const rgba = new Uint8ClampedArray(buffer), count = width*height;
    const seed = y*width+x, start = seed*4;
    if (rgba[start+3] < 8) { self.postMessage({spans:[],pixels:0}); return; }
    const r=rgba[start], g=rgba[start+1], b=rgba[start+2];
    const seen = new Uint8Array(count), queue = new Int32Array(count);
    let head=0,tail=0,pixels=0,minY=y,maxY=y;
    function visit(i) {
      if (seen[i]) return;
      seen[i]=1;
      const offset=i*4;
      if (rgba[offset+3] < 8 || Math.max(Math.abs(rgba[offset]-r),Math.abs(rgba[offset+1]-g),Math.abs(rgba[offset+2]-b)) > tolerance) return;
      seen[i]=2; queue[tail++]=i;
    }
    visit(seed);
    while(head<tail) {
      const i=queue[head++], row=Math.floor(i/width), col=i-row*width;
      pixels++; minY=Math.min(minY,row); maxY=Math.max(maxY,row);
      if(col>0) visit(i-1); if(col+1<width) visit(i+1);
      if(row>0) visit(i-width); if(row+1<height) visit(i+width);
    }
    const spans=[];
    for(let row=minY;row<=maxY;row++) {
      let col=0;
      while(col<width) {
        if(seen[row*width+col]!==2) {col++;continue;}
        const left=col++;
        while(col<width && seen[row*width+col]===2) col++;
        spans.push([row,left,col]);
        if(spans.length>100000) throw new Error('Selection is too complex. Lower the tolerance or use the brush for this area.');
      }
    }
    self.postMessage({spans,pixels});
  } catch(error) {self.postMessage({error:error.message});}
};
