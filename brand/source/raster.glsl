// Side view.
vec4 px(vec2 p){
  float px1=2.1/res.x;
  vec4 bg=mode>.5?tile(p,px1):vec4(0.);
  vec2 k=toKey(p);
  float d=key2d(k);
  vec3 m=mesh(k);
  float glow=.17*exp(-max(d,0.)/.022);          // faint colored halo
  vec4 halo=vec4(m*glow,glow);
  float aa=px1/.92*.8, a=smoothstep(aa,-aa,d);
  vec4 shape=vec4(face(k,px1)*a,a);
  return over(shape,over(halo*(1.-a),bg));
}
void main(){ vec4 acc=vec4(0.);
  for(int i=0;i<4;i++)for(int j=0;j<4;j++){
    vec2 f=gl_FragCoord.xy+(vec2(float(i),float(j))+.5)/4.-.5;
    acc+=px((f/res-.5)*2.1);
  }
  o=acc/16.;
}
