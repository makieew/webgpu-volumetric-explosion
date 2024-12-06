struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) texcoords : vec2f,
}

@group(0) @binding(0) var texture: texture_2d<f32>;
@group(0) @binding(1) var texsampler: sampler;

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
    
    let texelSize = vec2f(1.0) / vec2f(textureDimensions(texture));

    var out = textureSample(texture, texsampler, texcoords + texelSize * vec2(-1.0, 1.0));
    out += textureSample(texture, texsampler, texcoords + texelSize * vec2(1.0, 1.0));
    out += textureSample(texture, texsampler, texcoords + texelSize * vec2(-1.0, -1.0));
    out += textureSample(texture, texsampler, texcoords + texelSize * vec2(1.0, -1.0));

    return out * 0.25;
}
