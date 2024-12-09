@group(0) @binding(0) var<uniform> threshold: f32;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var outputTexture: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let texcoords = vec2f(id.xy) / vec2f(textureDimensions(inputTexture));

    let color = textureLoad(inputTexture, vec2<i32>(id.xy), 0).rgb;
    let brightness = dot(color, vec3f(0.2126, 0.7152, 0.0722));

    var brightColor: vec3f;
    if (brightness > threshold) {
        brightColor = color;
    } else {
        brightColor = vec3f(0.0, 0.0, 0.0);
    }

    textureStore(outputTexture, vec2<i32>(id.xy), vec4f(brightColor, 1.0));
}