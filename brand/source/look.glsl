// Look shared by every render: white tile and front face of the key.
float sq(vec2 p, float r){ vec2 q=abs(p)/r; return pow(pow(q.x,5.)+pow(q.y,5.),.2)-1.; }
vec4 over(vec4 top, vec4 bot){ return top+bot*(1.-top.a); }
vec2 toKey(vec2 p){ return (p-vec2(.075,.0))/.92; }
vec4 tile(vec2 p, float px1){
  float s=sq(p,.98), a=smoothstep(px1,-px1,s);
  float rim=smoothstep(-.03,-.002,s);
  vec3 t=mix(vec3(1.),C(235.,237.,241.),clamp((.98-p.y)/1.96,0.,1.));
  t=mix(t,vec3(1.),rim*.8);
  return vec4(t*a,a);
}
vec3 face(vec2 k, float px1){
  float e=.0008;
  float d=key2d(k);
  vec2 g=normalize(vec2(key2d(k+vec2(e,0.))-key2d(k-vec2(e,0.)),key2d(k+vec2(0.,e))-key2d(k-vec2(0.,e)))+1e-6);
  vec3 m=mesh(k);
  // relief: soft rim on the edges, light from the top left
  float t=smoothstep(-.040,0.,d);
  vec2 l=normalize(vec2(-.45,.89));
  float lit=dot(g,l);
  vec3 col=m*mix(1.04,.94,clamp((.34-k.y)/.68,0.,1.));
  col=mix(col,col*.84+C(4.,30.,170.)*.10,t*max(-lit,0.)*.9);
  col=mix(col,mix(col,vec3(1.),.55),t*t*max(lit,0.)*.85);
  col=mix(col,mix(m,vec3(1.),.22),smoothstep(-.007,-.002,d)*.45);
  float aa=px1/.92*.8; float gd=glyph(k), gl=smoothstep(aa,-aa,gd);
  vec2 gg=normalize(vec2(glyph(k+vec2(e,0.))-glyph(k-vec2(e,0.)),glyph(k+vec2(0.,e))-glyph(k-vec2(0.,e)))+1e-6);
  float gt=smoothstep(-.012,0.,gd);
  float gs=dot(gg,l);
  vec3 eng=mix(m,C(150.,226.,255.),.42);
  eng=mix(eng,eng*.62,gt*max(gs,0.));              // inner shadow at the top
  eng=mix(eng,mix(eng,vec3(1.),.45),gt*max(-gs,0.)); // light at the bottom
  col=mix(col,eng,gl);
  float lip=smoothstep(.012,.0,gd)*(1.-gl);
  return mix(col,mix(col,vec3(1.),.28),lip*max(-gs,0.));
}
