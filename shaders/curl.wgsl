// Curl noise - FIX
fn curlNoise(position: vec3f, seed: u32, delta: f32) -> vec3f {
    let value1 = perlinNoise(position + vec3f(-delta, -delta, -delta), seed);
    let value2 = perlinNoise(position + vec3f(delta, -delta, -delta), seed);
    let value3 = perlinNoise(position + vec3f(-delta, delta, -delta), seed);
    let value4 = perlinNoise(position + vec3f(-delta, -delta, delta), seed);
    let value5 = perlinNoise(position + vec3f(delta, -delta, delta), seed);
    let value6 = perlinNoise(position + vec3f(-delta, delta, delta), seed);
    let value7 = perlinNoise(position + vec3f(delta, delta, -delta), seed);
    let value8 = perlinNoise(position + vec3f(delta, delta, delta), seed);

    let curlX = (value6 + value4) - (value7 + value3);
    let curlY = (value2 + value1) - (value8 + value6);
    let curlZ = (value3 + value1) - (value5 + value4);

    return vec3f(curlX, curlY, curlZ);
}