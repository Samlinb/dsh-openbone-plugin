// Exact decimal predicates match the Java model's BigDecimal.valueOf(double) contract.
// Fast determinant first; BigInt is used only when cancellation makes its sign uncertain.
function decimal(v){const [mantissa,exp='0']=String(v).split('e'),dot=mantissa.indexOf('.'),digits=dot<0?0:mantissa.length-dot-1;return {n:BigInt(mantissa.replace('.','')),e:Number(exp)-digits};}
function subtract(a,b){const e=Math.min(a.e,b.e);return {n:a.n*10n**BigInt(a.e-e)-b.n*10n**BigInt(b.e-e),e};}
function multiply(a,b){return {n:a.n*b.n,e:a.e+b.e};}
export function exactCross(a,b,c){const x=subtract(decimal(b[0]),decimal(a[0])),y=subtract(decimal(b[1]),decimal(a[1])),u=subtract(decimal(c[0]),decimal(a[0])),v=subtract(decimal(c[1]),decimal(a[1]));return subtract(multiply(x,v),multiply(y,u));}
export function orient(a,b,c){const x=(b[0]-a[0])*(c[1]-a[1]),y=(b[1]-a[1])*(c[0]-a[0]),v=x-y;
  if(Number.isFinite(v)&&Math.abs(v)>(Math.abs(x)+Math.abs(y))*1e-14)return Math.sign(v);
  const n=exactCross(a,b,c).n;return n<0n?-1:n>0n?1:0;}
export function areaSign(p){let sum={n:0n,e:0};for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length],cross=subtract(multiply(decimal(a[0]),decimal(b[1])),multiply(decimal(a[1]),decimal(b[0])));sum=subtract(sum,{n:-cross.n,e:cross.e});}return sum.n<0n?-1:sum.n>0n?1:0;}
function scientific(d){if(d.n===0n)return [0,0];const sign=d.n<0n?-1:1,s=String(d.n<0n?-d.n:d.n);return [sign*Number(s.slice(0,17))/10**(Math.min(17,s.length)-1),d.e+s.length-1];}
export function intersectionFraction(a,b,c,d){const x=exactCross(c,d,a),y=exactCross(c,d,b),den=subtract(x,y),[u,ue]=scientific(x),[v,ve]=scientific(den);return Math.max(0,Math.min(1,(u/v)*10**(ue-ve)));}
