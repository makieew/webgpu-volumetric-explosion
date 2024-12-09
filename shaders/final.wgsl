struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) texcoords : vec2f,
}

@group(0) @binding(0) var render_texture: texture_2d<f32>;
@group(0) @binding(1) var bloom_texture: texture_2d<f32>;
@group(0) @binding(2) var texsampler: sampler;

@vertex
fn vertex_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;

    const pos = array(
        vec2( 1.0,  1.0),
        vec2( 1.0, -1.0),
        vec2(-1.0, -1.0),
        vec2( 1.0,  1.0),
        vec2(-1.0, -1.0),
        vec2(-1.0,  1.0),
    );

    const texcoords = array(
        vec2(1.0, 0.0),
        vec2(1.0, 1.0),
        vec2(0.0, 1.0),
        vec2(1.0, 0.0),
        vec2(0.0, 1.0),
        vec2(0.0, 0.0),
    );

    output.position = vec4(pos[vertexIndex], 0.0, 1.0);
    output.texcoords = texcoords[vertexIndex];
    return output;
}

@fragment
fn fragment_main(@location(0) texcoords : vec2f) -> @location(0) vec4f {

    const gamma = 2.2;
    const exposure = 1.0;
    
    let original = textureSample(render_texture, texsampler, texcoords).rgb;
    let bloom = textureSample(bloom_texture, texsampler, texcoords).rgb;
    let intensity = 1.0;

    let hdrColor = original + bloom * intensity;

    // tone-mapping FIX
    let toneMapped = vec3f(1.0) - exp(-hdrColor * exposure); // fix bit grayish

    let result = pow(toneMapped, vec3f(1.0 / gamma)); // fix - everything lighter ??

    return vec4f(hdrColor, 1.0);
}