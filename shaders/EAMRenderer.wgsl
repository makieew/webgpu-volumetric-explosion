struct VertexOutput {
    @builtin(position) Position: vec4f,
    @location(0) rayFrom: vec3f,
    @location(1) rayTo: vec3f
};

struct Uniforms {
    volumeMatrix : mat4x4f,
    inverseMvp : mat4x4f,
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
@group(1) @binding(4) var colorTexture: texture_1d<f32>;
@group(1) @binding(5) var depthTexture: texture_depth_2d;
@group(1) @binding(6) var<uniform> opacity: f32;

const NumSteps = 16u; //256


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

fn transferFunction(tempSample: f32, densitySample: f32) -> vec3f {
  // +alpha +skalacija slider
  let color = textureSample(colorTexture, mySampler, tempSample).rgb;
  let densColor = color * densitySample;

  return densColor;
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

  let dist: f32 = tmax - tmin;
  let stepSize: f32 = dist / f32(NumSteps);

  // perlin parameters
  let frequency: i32 = 4;
  let octaveCount: i32 = 2;
  let persistence: f32 = 0.5;
  let lacunarity: f32 = 2;
  let seed: u32 = 0x578437adu;

  // depth testing
  let viewProjMatrix = camera.projectionMatrix * camera.viewMatrix;
  var accumulatedColor: vec3f = vec3f(0.0);
  var accumulatedAlpha: f32 = 0.0;

  for (var i = 0u; i < NumSteps; i++) {

    let t: f32 = tmin + f32(i) * stepSize;

    rayPos = rayFrom + t * rayDir;
    let texCoord: vec3f = (rayPos + 1.0) * 0.5;

    // depth testing
    let clipPos = viewProjMatrix * vec4(rayPos, 1.0);
    let ndcPos = clipPos.xyz / clipPos.w;
    let screenCoords = (ndcPos.xy * 0.5) + 0.5;
    let screenDepth = 0.5 * (ndcPos.z + 1.0);

    let depthValue = textureSample(depthTexture, mySampler, screenCoords);
    //let depthWeight = select(0.0, 1.0, screenDepth < depthValue);
    let depthWeight = 1.0;

    //
    var densitySample = textureSample(myTexture, mySampler, texCoord).r;
    var tempSample = quasiCubicSampling(tempTexture, mySampler, texCoord).r;

    // noise
    // CURL - FIX
    let curlV = curlNoise(texCoord * 16.0, seed, 0.01);
    // let normFactor = length(curlV); // normalize?

    // WORLEY
    // texCoord + curl vec3 (* skalacija) curl
    // let noiseFactor = 1.0 - worleyNoise(texCoord * 16.0 + curlV * 5, 1.5); // p, power
    // let normFactor = noiseFactor; //TEST

    // PERLIN
    let noiseFactor = perlinNoiseMultiOctave(texCoord, frequency, octaveCount, persistence, lacunarity, seed);
    let normFactor = noiseFactor; // normalized values [-1, 1] -> [0, 1]

    // densitySample *= 1.0 - normFactor * 0.5; // densSamp = normFactor
    tempSample = mix(tempSample, tempSample * (1.0 - noiseFactor), 0.3);
    densitySample = mix(densitySample, densitySample * (1.0 - noiseFactor), 0.5);

    // densitySample = normFactor;

    var color: vec3f = transferFunction(tempSample, densitySample);

    //let rgbTemp = result.rgb + (1.0 - result.a) * color * densitySample / f32(NumSteps) * opacity;
    //let alpha = result.a + (1.0 - result.a) * densitySample / f32(NumSteps) * opacity;

    //result = vec4f(rgbTemp, alpha);

    let weightedDensity = densitySample * depthWeight;
    accumulatedColor += (1.0 - accumulatedAlpha) * color * weightedDensity / f32(NumSteps) * opacity;
    accumulatedAlpha += (1.0 - accumulatedAlpha) * weightedDensity / f32(NumSteps) * opacity;

    // debug noise
    //result = vec4f(vec3f(normFactor), 1.0);
  }

  // was return result
  return vec4f(accumulatedColor, accumulatedAlpha);
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
