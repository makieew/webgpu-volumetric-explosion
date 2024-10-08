// Worley noise
fn hashWorley(p: vec3f) -> vec3f {
  var p3 = fract(p * vec3f(0.1031,0.1030,0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx)*p3.zyx);
}

fn worleyNoise(p: vec3f, power: f32) -> f32 {
  var finalDist = 9999999.0;

  for(var x: i32 = -1; x <= 1; x++){
    for(var y: i32 = -1; y <= 1; y++){
      for(var z: i32 = -1; z <= 1; z++){
        let offset = vec3f(f32(x), f32(y), f32(z));
        let dist = pow(distance(p, floor(p)+offset+hashWorley(floor(p)+offset)), power);
        finalDist = min(finalDist, dist);
      }
    }
  }
  return finalDist;
}