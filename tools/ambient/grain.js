// writes a 256x256 grayscale+alpha noise PNG as base64 for the grain overlay
const zlib=require("zlib");
function crc32(buf){let c,crc=0xffffffff;for(let n=0;n<buf.length;n++){c=(crc^buf[n])&0xff;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crc=(crc>>>8)^c;}return (crc^0xffffffff)>>>0;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(td));return Buffer.concat([l,td,c]);}
module.exports=function(N=256,seed=7){let s=seed;const r=()=>(s=(s*16807)%2147483647)/2147483647;
 const raw=Buffer.alloc(N*(N*2+1));for(let y=0;y<N;y++){raw[y*(N*2+1)]=0;for(let x=0;x<N;x++){const v=r();const o=y*(N*2+1)+1+x*2;
  const g=v<.5?0:255; raw[o]=g; raw[o+1]=Math.floor(Math.pow(Math.abs(v-.5)*2,2.2)*255);}}
 const ih=Buffer.alloc(13);ih.writeUInt32BE(N,0);ih.writeUInt32BE(N,4);ih[8]=8;ih[9]=4;ih[10]=0;ih[11]=0;ih[12]=0;
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ih),chunk("IDAT",zlib.deflateSync(raw,{level:9})),chunk("IEND",Buffer.alloc(0))]);
 return "data:image/png;base64,"+png.toString("base64");};
