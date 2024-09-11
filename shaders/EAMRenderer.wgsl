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

fn computeResult(tmin: f32, tmax: f32, rayFrom: vec3f, rayDir: vec3f) -> vec4f {

  var result = vec4f(0.0);
  var rayPos: vec3f = rayFrom;

  let opacity: f32 = 10.0;

  let dist: f32 = tmax - tmin;
  let stepSize: f32 = dist / f32(NumSteps);

  for (var i = 0u; i < NumSteps; i++) {

    let t: f32 = tmin + f32(i) * stepSize;

    let samplePos: vec3f = rayFrom + t * rayDir;
    let texCoord: vec3f = (samplePos + 1.0) * 0.5;

    //let texCoord = (rayPos.xyz + 1.0) * 0.5;

    let sample = textureSample(myTexture, mySampler, texCoord).r;

    result.a += (1.0 - result.a) * sample / f32(NumSteps) * opacity;
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
