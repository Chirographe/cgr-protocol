// Chirographe: the single definition of shape and colors.
// Everything in dist/ derives from it: node brand/build.mjs
//   key2d(p)  key silhouette (signed distance, negative inside)
//   glyph(p)  engraved initials
//   mesh(p)   material color
float smin(float a,float b,float k){ float h=max(k-abs(a-b),0.)/k; return min(a,b)-h*h*k*.25; }
float rbox(vec2 p, vec2 b, float r){ vec2 d=abs(p)-b+r; return length(max(d,0.))+min(max(d.x,d.y),0.)-r; }
float seg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
float smax(float a,float b,float k){ return -smin(-a,-b,k); }
float cham(vec2 p, vec2 b, float c, float k){ vec2 q=abs(p); return smax(max(q.x-b.x,q.y-b.y),(q.x+q.y-(b.x+b.y-c))*.7071,k); }
const vec2 BOW=vec2(-.52,0.);
float key2d(vec2 p){
  float d=cham(p-BOW,vec2(.38,.285),.135,.02);
  d=smin(d,rbox(p-vec2(.22,0.),vec2(.66,.165),.05),.11);
  // beveled tip
  d=smax(d,dot(p-vec2(.80,-.10),normalize(vec2(1.,-1.))),.035);
  // notches cut into the blade
  d=smax(d,-rbox(p-vec2(.545,-.200),vec2(.050,.115),.020),.016);
  d=smax(d,-rbox(p-vec2(.355,-.225),vec2(.050,.115),.020),.016);
  d=max(d,-cham(p-BOW,vec2(.20,.105),.105,.008));
  return d;
}
float arc(vec2 q, float r, float a0, float a1){
  float t=atan(q.y,q.x); if(t<a0-.0001) t+=6.2831853;
  float m=a1; float inside=step(a0,t)*step(t,m);
  vec2 e0=r*vec2(cos(a0),sin(a0)), e1=r*vec2(cos(a1),sin(a1));
  return inside>.5?abs(length(q)-r):min(length(q-e0),length(q-e1));
}
float glyph(vec2 p){
  const float sc=.78, r=.085, w=.0185;
  vec2 q=(p-vec2(.11,.012))/sc;
  float PI=3.14159265;
  float d=arc(q-vec2(-.225,0.),r,.78,2.*PI-.78);                                  // C
  float g=.0;
  d=min(d,arc(q-vec2(g,0.),r,.78,2.*PI-.06));                                    // G
  d=min(d,seg(q,vec2(g+.012,-.005),vec2(g+r,-.005)));
  float x=.185;
  d=min(d,seg(q,vec2(x,-r),vec2(x,r)));                                          // R: stem
  d=min(d,seg(q,vec2(x,r),vec2(x+.055,r)));
  d=min(d,arc(q-vec2(x+.055,.04),.045,-PI*.5,PI*.5));                            // R: bowl
  d=min(d,seg(q,vec2(x,-.005),vec2(x+.055,-.005)));
  d=min(d,seg(q,vec2(x+.048,-.005),vec2(x+.108,-r)));                            // R: leg
  return (d-w)*sc;
}
vec3 C(float r,float g,float b){ return vec3(r,g,b)/255.; }
vec3 mesh(vec2 p){
  vec3 s=vec3(0.); float w=0.,k;
  #define A(x,y,sg,col) k=exp(-dot(p-vec2(x,y),p-vec2(x,y))/(sg*sg)); s+=k*col; w+=k;
  A(-.80,.36,.36,C(130.,236.,255.))
  A(-.40,.26,.32,C(50.,190.,255.))
  A(-.62,-.34,.36,C(14.,99.,255.))
  A(-.02,.12,.30,C(16.,140.,255.))
  A(.40,.12,.30,C(10.,110.,255.))
  A(.82,.10,.26,C(80.,105.,255.))
  A(.70,-.18,.24,C(84.,62.,240.))
  A(.20,-.20,.26,C(6.,52.,214.))
  return s/w;
}
