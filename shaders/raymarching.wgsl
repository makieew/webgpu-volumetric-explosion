fn unproject(position: vec2f, inverseMvp: mat4x4f, outFrom: ptr<function, vec3f>, outTo: ptr<function, vec3f>) {
    var nearPosition =  vec4f(position, 0.0, 1.0);
    var farPosition = vec4f(position, 1.0, 1.0);
    var fromDirty: vec4f = inverseMvp * nearPosition;
    var toDirty: vec4f = inverseMvp * farPosition;
    *outFrom = fromDirty.xyz / fromDirty.w;
    *outTo = toDirty.xyz / toDirty.w;
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