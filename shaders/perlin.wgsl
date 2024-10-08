// implementation of 3D Perlin Noise by MurmurHash
fn hash1D(x: u32, seed: u32) -> u32 {
  let m: u32 = 0x5bd1e995u;
  var hash = seed;
  // process input
  var k = x;
  k *= m;
  k ^= k >> 24u;
  k *= m;
  hash *= m;
  hash ^= k;
  // some final mixing
  hash ^= hash >> 13u;
  hash *= m;
  hash ^= hash >> 15u;
  return hash;
}

fn hash3D(x: vec3<u32>, seed: u32)  -> u32 {
  let m: u32 = 0x5bd1e995u;
  var hash = seed;
  // process first vector element
  var k = x.x;
  k *= m;
  k ^= k >> 24u;
  k *= m;
  hash *= m;
  hash ^= k;
  // process second vector element
  k = x.y;
  k *= m;
  k ^= k >> 24u;
  k *= m;
  hash *= m;
  hash ^= k;
  // process third vector element
  k = x.z;
  k *= m;
  k ^= k >> 24u;
  k *= m;
  hash *= m;
  hash ^= k;
  // some final mixing
  hash ^= hash >> 13u;
  hash *= m;
  hash ^= hash >> 15u;
  return hash;
}

fn gradientDirection(hash: u32) -> vec3f {
  switch(hash & 15u) {   // look at the last four bits to pick a gradient direction
      case 0: { return vec3f(1.0, 1.0, 0.0); }
      case 1: { return vec3f(-1.0, 1.0, 0.0); }
      case 2: { return vec3f(1.0, -1.0, 0.0); }
      case 3: { return vec3f(-1.0, -1.0, 0.0); }
      case 4: { return vec3f(1.0, 0.0, 1.0); }
      case 5: { return vec3f(-1.0, 0.0, 1.0); }
      case 6: { return vec3f(1.0, 0.0, -1.0); }
      case 7: { return vec3f(-1.0, 0.0, -1.0); }
      case 8: { return vec3f(0.0, 1.0, 1.0); }
      case 9: { return vec3f(0.0, -1.0, 1.0); }
      case 10: { return vec3f(0.0, 1.0, -1.0); }
      case 11: { return vec3f(0.0, -1.0, -1.0); }
      case 12: { return vec3f(1.0, 1.0, 0.0); }
      case 13: { return vec3f(-1.0, 1.0, 0.0); }
      case 14: { return vec3f(0.0, -1.0, 1.0); }
      case 15: { return vec3f(0.0, -1.0, -1.0); }
      default: { return vec3f(0.0); }
  }
}

fn interpolate(value1: f32, value2: f32, value3: f32, value4: f32, value5: f32, value6: f32, value7: f32, value8: f32, t: vec3f) -> f32 {
  return mix(
      mix(mix(value1, value2, t.x), mix(value3, value4, t.x), t.y),
      mix(mix(value5, value6, t.x), mix(value7, value8, t.x), t.y),
      t.z
  );
}

fn fade(t: vec3f) -> vec3f {
  // 6t^5 - 15t^4 + 10t^3
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn perlinNoise(position: vec3f, seed: u32) -> f32 {
  let floorPos = floor(position);
  let fractPos = position - floorPos;
  let cellCoords = vec3<u32>(floorPos);

  let value1 = dot(gradientDirection(hash3D(cellCoords, seed)), fractPos);
  let value2 = dot(gradientDirection(hash3D(cellCoords + vec3<u32>(1, 0, 0), seed)), fractPos - vec3(1.0, 0.0, 0.0));
  let value3 = dot(gradientDirection(hash3D(cellCoords + vec3<u32>(0, 1, 0), seed)), fractPos - vec3(0.0, 1.0, 0.0));
  let value4 = dot(gradientDirection(hash3D(cellCoords + vec3<u32>(1, 1, 0), seed)), fractPos - vec3(1.0, 1.0, 0.0));
  let value5 = dot(gradientDirection(hash3D(cellCoords + vec3<u32>(0, 0, 1), seed)), fractPos - vec3(0.0, 0.0, 1.0));
  let value6 = dot(gradientDirection(hash3D(cellCoords + vec3<u32>(1, 0, 1), seed)), fractPos - vec3(1.0, 0.0, 1.0));
  let value7 = dot(gradientDirection(hash3D(cellCoords + vec3<u32>(0, 1, 1), seed)), fractPos - vec3(0.0, 1.0, 1.0));
  let value8 = dot(gradientDirection(hash3D(cellCoords + vec3<u32>(1, 1, 1), seed)), fractPos - vec3(1.0, 1.0, 1.0));

  return interpolate(value1, value2, value3, value4, value5, value6, value7, value8, fade(fractPos));
}

fn perlinNoiseMultiOctave(position: vec3f, frequency: i32, octaveCount: i32, persistence: f32, lacunarity: f32, seed: u32) -> f32 {
  var value: f32 = 0.0;
  var amplitude: f32 = 1.0;
  var currentFrequency: f32 = f32(frequency);
  var currentSeed: u32 = seed;

  for (var i: i32 = 0; i < octaveCount; i++) {
      currentSeed = hash1D(currentSeed, 0x0u); // create a new seed for each octave
      value += perlinNoise(position * currentFrequency, currentSeed) * amplitude;
      amplitude *= persistence;
      currentFrequency *= lacunarity;
  }
  return value;
}