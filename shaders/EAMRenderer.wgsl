struct VertexOutput {
    @builtin(position) Position: vec4f,
    @location(0) rayFrom: vec3f,
    @location(1) rayTo: vec3f
};

struct Uniforms {
    volumeMatrix : mat4x4f,
    inverseMvp : mat4x4f, // + matrika modela preveri
}

struct CameraUniforms {
    viewMatrix : mat4x4f,
    projectionMatrix : mat4x4f,
}

@group(0) @binding(0) var<uniform> camera : CameraUniforms;

@group(1) @binding(0) var<uniform> uniforms: Uniforms;
@group(1) @binding(1) var mySampler: sampler;
@group(1) @binding(2) var myTexture: texture_3d<f32>;
@group(1) @binding(3) var tempTexture: texture_3d<f32>;

const NumSteps = 64u; //256

fn unproject(position: vec2f, inverseMvp: mat4x4f, outFrom: ptr<function, vec3f>, outTo: ptr<function, vec3f>) {
    var nearPosition =  vec4f(position, 0.0, 1.0);
    var farPosition = vec4f(position, 1.0, 1.0);
    var fromDirty: vec4f = inverseMvp * nearPosition;
    var toDirty: vec4f = inverseMvp * farPosition;
    *outFrom = fromDirty.xyz / fromDirty.w;
    *outTo = toDirty.xyz / toDirty.w;
}

@vertex
fn vertex_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {

  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );

  var xy = pos[VertexIndex];

  var rayFrom: vec3f;
  var rayTo: vec3f;

  var worldPos = vec4f(xy, 0.0, 1.0);
  var viewProjPos = camera.projectionMatrix * camera.viewMatrix * uniforms.volumeMatrix * worldPos;

  unproject(xy, uniforms.inverseMvp, &rayFrom, &rayTo);

  return VertexOutput(
    worldPos,
    rayFrom,
    rayTo
  );
}

fn intersectCube(origin: vec3f, direction: vec3f) -> vec2f {
	let tmin: vec3f = (vec3f(-1.0) - origin) / direction;
	let tmax: vec3f = (vec3f(1.0) - origin) / direction;

  // t1 - nearest t2 - farthest
	let t1: vec3f = min(tmin, tmax);
	let t2: vec3f = max(tmin, tmax);

	let tnear: f32 = max(max(t1.x, t1.y), t1.z);
	let tfar: f32 = min(min(t2.x, t2.y), t2.z);

	return vec2f(tnear, tfar);
}

// optimize -> cpu
const infernoPalette = array<vec3f, 6>(
    vec3f(0.2, 0.2, 0.2),      // Dark gray
    vec3f(0.3, 0.3, 0.3),      // Lighter gray
    vec3f(0.4, 0.4, 0.4),      // Even lighter gray
    vec3f(0.9, 0.3,  0.3),  // Orange
    vec3f(1.0, 0.9, 0.1),  // Yellow
    vec3f(1.0, 1.0, 0.6)   // Bright yellow-white
);

fn interpolateColor(color1: vec3f, color2: vec3f, t: f32) -> vec3f {
    return mix(color1, color2, t);
}

fn infernoColor(tempValue: f32) -> vec3f {
    let size = 5u;

    let scaledTemp = pow(tempValue, 0.9);
    let scaled = scaledTemp * f32(size);
    let i1 = u32(scaled);
    let i2 = min(i1 + 1u, size); 
    let t = fract(scaled);

    return interpolateColor(infernoPalette[i1], infernoPalette[i2], t);
}

fn transferFunction(tempSample: f32, densitySample: f32) -> vec3f {
  let normTemp = clamp(tempSample, 0.0, 1.0);
  let color = infernoColor(normTemp);
  return color * densitySample;
}

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

fn quasiCubicSampling (volume: texture_3d<f32>, sampler: sampler, u: vec3f) -> vec4f {
    let R = vec3f(textureDimensions(volume));
    var U = u * R + 0.5;
    let F = fract(U);
    U = floor(U) + F * F * (3.0 - 2.0 * F);
    return textureSample(volume, sampler, (U - vec3<f32>(0.5)) / R);
}

fn computeResult(tmin: f32, tmax: f32, rayFrom: vec3f, rayDir: vec3f) -> vec4f {

  var result = vec4f(0.0);
  var rayPos: vec3f = rayFrom;

  let opacity: f32 = 20.0;  //make slider

  let dist: f32 = tmax - tmin;
  let stepSize: f32 = dist / f32(NumSteps);

  // perlin parameters
  let frequency: i32 = 4;
  let octaveCount: i32 = 2;
  let persistence: f32 = 0.5;
  let lacunarity: f32 = 2;
  let seed: u32 = 0x578437adu;

  for (var i = 0u; i < NumSteps; i++) {

    let t: f32 = tmin + f32(i) * stepSize;

    rayPos = rayFrom + t * rayDir;
    let texCoord: vec3f = (rayPos + 1.0) * 0.5;

    var densitySample = textureSample(myTexture, mySampler, texCoord).r;
    var tempSample = quasiCubicSampling(tempTexture, mySampler, texCoord).r;

    // noise
    let noiseFactor = 1.0 - worleyNoise(texCoord * 16.0, 1.5); // p, power
    let normFactor = noiseFactor;

    //let noiseFactor = perlinNoiseMultiOctave(texCoord, frequency, octaveCount, persistence, lacunarity, seed);
    //let normFactor = (noiseFactor + 1.0) * 0.5; // normalized values [-1, 1] -> [0, 1]

    densitySample *= 1.0 - normFactor * 0.5;
    tempSample *= 1.0 - normFactor * 0.3;

    var color: vec3f = transferFunction(tempSample, densitySample);

    let rgbTemp = result.rgb + (1.0 - result.a) * color * densitySample / f32(NumSteps) * opacity;
    let alpha = result.a + (1.0 - result.a) * densitySample / f32(NumSteps) * opacity;

    result = vec4f(rgbTemp, alpha);

    // debug noise
    //result = vec4f(vec3f(normFactor), 1.0);
  }

  return result;
}

@fragment
fn fragment_main(@location(0) rayFrom: vec3f, @location(1) rayTo: vec3f) -> @location(0) vec4f {
  let rayDir: vec3f = rayTo - rayFrom;
  let tbounds: vec2f = intersectCube(rayFrom, rayDir);
  
  let validIntersection: f32 = step(tbounds.x, tbounds.y);
  let tmin: f32 = tbounds.x;
  let tmax: f32 = tbounds.y;

  let computedResult = computeResult(tmin, tmax, rayFrom, rayDir);
  
  var result = mix(vec4f(0.0, 0.0, 0.0, 0.0), computedResult, validIntersection);

  // DEBUG
  // Visualising tmin and tmax
  //let tminColor = vec3f(tmin, 0.0, 0.0); // Red channel for tmin
  //let tmaxColor = vec3f(0.0, 0.0, tmax); // Green channel for tmax
  //let finalColor = vec4f(tminColor + tmaxColor, 1); // Combine them with full alpha

  return result;
}
