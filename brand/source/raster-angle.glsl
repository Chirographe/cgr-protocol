// Slightly tilted view: the camera goes under the key and shows its edge.
float volume(vec3 q){
  vec2 w=vec2(key2d(q.xy)+BEVEL,abs(q.z)-(THICKNESS-BEVEL));
  return min(max(w.x,w.y),0.)+length(max(w,0.))-BEVEL;
}
vec3 normalAt(vec3 q){
  vec2 e=vec2(.0012,0.);
  return normalize(vec3(volume(q+e.xyy)-volume(q-e.xyy),volume(q+e.yxy)-volume(q-e.yxy),volume(q+e.yyx)-volume(q-e.yyx)));
}
vec3 side(vec3 q, vec3 n){
  vec3 m=mesh(q.xy);
  float top=.5+.5*n.y;
  vec3 col=mix(C(3.,28.,158.),m,smoothstep(.12,.88,top));
  col*=.92+.20*max(-n.x,0.);                     // left side slightly brighter
  vec3 l=normalize(vec3(-.30,.75,.60));
  float shine=pow(max(dot(n,normalize(l+vec3(0.,0.,1.))),0.),30.);
  return col+vec3(.55,.82,1.)*shine*.16;
}
vec4 px(vec2 p){
  float px1=2.1/res.x;
  vec4 bg=mode>.5?tile(p,px1):vec4(0.);
  vec2 k=toKey(p);
  float a=radians(PITCH), b=radians(YAW);
  vec3 f=-vec3(sin(b)*cos(a),-sin(a),cos(b)*cos(a));   // the camera looks up
  vec3 r=normalize(cross(f,vec3(0.,1.,0.))), u=cross(r,f);
  vec3 ro=vec3(-.01,0.,0.)+r*(k.x+.01)+u*k.y-f*.5;
  float t=0., nearest=1.; vec2 seenAt=k; bool hit=false;
  for(int i=0;i<72;i++){
    vec3 q=ro+f*t; float h=volume(q);
    if(h<nearest){ nearest=h; seenAt=q.xy; }
    if(h<.0004){ hit=true; break; }
    t+=h*.95; if(t>1.2) break;
  }
  float glow=.17*exp(-max(nearest,0.)/.022);
  vec4 halo=vec4(mesh(seenAt)*glow,glow);
  if(!hit) return over(halo,bg);
  vec3 q=ro+f*t, n=normalAt(q);
  float front=smoothstep(.70,.97,n.z);
  vec3 col=mix(side(q,n),face(q.xy,px1),front);
  return over(vec4(col,1.),bg);
}
void main(){ vec4 acc=vec4(0.);
  for(int i=0;i<4;i++)for(int j=0;j<4;j++){
    vec2 f=gl_FragCoord.xy+(vec2(float(i),float(j))+.5)/4.-.5;
    acc+=px((f/res-.5)*2.1);
  }
  o=acc/16.;
}
