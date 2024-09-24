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

const NumSteps = 64u;

// EAMRenderer unproject, intersect cube, v shaderju

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

const infernoPalette = array<vec3f, 6>(
    //vec3f(0.001462, 0.000466, 0.013866),  // Dark purple
    //vec3f(0.281412, 0.155834, 0.469201),  // Purple-blue
    //vec3f(0.616293, 0.233965, 0.621305),  // Magenta
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

fn permute4(x: vec4f) -> vec4f { return ((x * 34. + 1.) * x) % vec4f(289.); }

fn taylorInvSqrt4(r: vec4f) -> vec4f { return 1.79284291400159 - 0.85373472095314 * r; }

fn fade3(t: vec3f) -> vec3f { return t * t * t * (t * (t * 6. - 15.) + 10.); }

fn perlinNoise(P: vec3f) -> f32 {
  var Pi0 : vec3f = floor(P);
  var Pi1 : vec3f = Pi0 + vec3f(1.);
  Pi0 = Pi0 % vec3f(289.);
  Pi1 = Pi1 % vec3f(289.);
  let Pf0 = fract(P);
  let Pf1 = Pf0 - vec3f(1.);
  let ix = vec4f(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  let iy = vec4f(Pi0.yy, Pi1.yy);
  let iz0 = Pi0.zzzz;
  let iz1 = Pi1.zzzz;

  let ixy = permute4(permute4(ix) + iy);
  let ixy0 = permute4(ixy + iz0);
  let ixy1 = permute4(ixy + iz1);

  var gx0: vec4f = ixy0 / 7.;
  var gy0: vec4f = fract(floor(gx0) / 7.) - 0.5;
  gx0 = fract(gx0);
  var gz0: vec4f = vec4f(0.5) - abs(gx0) - abs(gy0);
  var sz0: vec4f = step(gz0, vec4f(0.));
  gx0 = gx0 + sz0 * (step(vec4f(0.), gx0) - 0.5);
  gy0 = gy0 + sz0 * (step(vec4f(0.), gy0) - 0.5);

  var gx1: vec4f = ixy1 / 7.;
  var gy1: vec4f = fract(floor(gx1) / 7.) - 0.5;
  gx1 = fract(gx1);
  var gz1: vec4f = vec4f(0.5) - abs(gx1) - abs(gy1);
  var sz1: vec4f = step(gz1, vec4f(0.));
  gx1 = gx1 - sz1 * (step(vec4f(0.), gx1) - 0.5);
  gy1 = gy1 - sz1 * (step(vec4f(0.), gy1) - 0.5);

  var g000: vec3f = vec3f(gx0.x, gy0.x, gz0.x);
  var g100: vec3f = vec3f(gx0.y, gy0.y, gz0.y);
  var g010: vec3f = vec3f(gx0.z, gy0.z, gz0.z);
  var g110: vec3f = vec3f(gx0.w, gy0.w, gz0.w);
  var g001: vec3f = vec3f(gx1.x, gy1.x, gz1.x);
  var g101: vec3f = vec3f(gx1.y, gy1.y, gz1.y);
  var g011: vec3f = vec3f(gx1.z, gy1.z, gz1.z);
  var g111: vec3f = vec3f(gx1.w, gy1.w, gz1.w);

  let norm0 = taylorInvSqrt4(
      vec4f(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 = g000 * norm0.x;
  g010 = g010 * norm0.y;
  g100 = g100 * norm0.z;
  g110 = g110 * norm0.w;
  let norm1 = taylorInvSqrt4(
      vec4f(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 = g001 * norm1.x;
  g011 = g011 * norm1.y;
  g101 = g101 * norm1.z;
  g111 = g111 * norm1.w;

  let n000 = dot(g000, Pf0);
  let n100 = dot(g100, vec3f(Pf1.x, Pf0.yz));
  let n010 = dot(g010, vec3f(Pf0.x, Pf1.y, Pf0.z));
  let n110 = dot(g110, vec3f(Pf1.xy, Pf0.z));
  let n001 = dot(g001, vec3f(Pf0.xy, Pf1.z));
  let n101 = dot(g101, vec3f(Pf1.x, Pf0.y, Pf1.z));
  let n011 = dot(g011, vec3f(Pf0.x, Pf1.yz));
  let n111 = dot(g111, Pf1);

  var fade_xyz: vec3f = fade3(Pf0);
  let temp = vec4f(f32(fade_xyz.z)); // simplify after chrome bug fix
  let n_z = mix(vec4f(n000, n100, n010, n110), vec4f(n001, n101, n011, n111), temp);
  let n_yz = mix(n_z.xy, n_z.zw, vec2f(f32(fade_xyz.y))); // simplify after chrome bug fix
  let n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
  return 2.2 * n_xyz;  
}

fn computeResult(tmin: f32, tmax: f32, rayFrom: vec3f, rayDir: vec3f) -> vec4f {

  var result = vec4f(0.0);
  var rayPos: vec3f = rayFrom;

  let opacity: f32 = 20.0;  //make slider

  let dist: f32 = tmax - tmin;
  let stepSize: f32 = dist / f32(NumSteps);

  for (var i = 0u; i < NumSteps; i++) {

    let t: f32 = tmin + f32(i) * stepSize;

    let samplePos: vec3f = rayFrom + t * rayDir;
    let texCoord: vec3f = (samplePos + 1.0) * 0.5;

    var densitySample = textureSample(myTexture, mySampler, texCoord).r;
    var tempSample = textureSample(tempTexture, mySampler, texCoord).r;

    // noise
    let noiseFactor = (perlinNoise(samplePos * 32) + 1.0) * 0.5; //normalized
    let smoothNoise = smoothstep(0.0, 1.0, noiseFactor);

    densitySample *= 1.0 + smoothNoise * 0.5;
    tempSample *= 1.0 + smoothNoise * 0.4;

    var color: vec3f = transferFunction(tempSample, densitySample);

    let rgbTemp = result.rgb + (1.0 - result.a) * color * densitySample / f32(NumSteps) * opacity;
    let alpha = result.a + (1.0 - result.a) * densitySample / f32(NumSteps) * opacity;

    // debug noise
    let noiseColor = vec3f(noiseFactor * 0.5 + 0.5); // less dark

    result = vec4f(rgbTemp, alpha);
    //result = vec4f(noiseColor, 1.0);
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

  //tmax-tmin presecisca, transparentno

  let computedResult = computeResult(tmin, tmax, rayFrom, rayDir);
  
  var result = mix(vec4f(0.0, 0.0, 0.0, 0.0), computedResult, validIntersection);

  // DEBUG
  // Visualising tmin and tmax
  let tminColor = vec3f(tmin, 0.0, 0.0); // Red channel for tmin
  let tmaxColor = vec3f(0.0, 0.0, tmax); // Green channel for tmax
  let finalColor = vec4f(tminColor + tmaxColor, 1); // Combine them with full alpha

  return result;
}
