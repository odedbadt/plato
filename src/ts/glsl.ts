export const VS_SOURCE = `precision mediump float;

in vec3 aVertexPosition;
in vec3 aNormalDirection;
in vec2 aTextureCoord;
out vec2 vTextureCoord;
out float vectorIndex;
out float fBrightness;

uniform mat3 model_transformer;
uniform mat4 projector;


vec3 lightDirection = vec3(-0.68041382,  0.27216553, -0.68041382);

void main(void) {

  vec4 projected = projector* vec4(model_transformer * aVertexPosition, 1.0);
  vec3 normal_after_rotation = model_transformer * aNormalDirection;
  gl_Position = projected;
  //gl_Position = vec4(aVertexPosition, 1.0);
  vTextureCoord = aTextureCoord;
  fBrightness = 0.7+0.3*dot(normalize(normal_after_rotation), 
                            normalize(lightDirection));
}
`
export const FS_SOURCE = `precision mediump float;
in vec2 vTextureCoord;
in float fBrightness;

out vec4 fragColor;
uniform sampler2D uTexture;

void main(void) {
    vec4 sampled = texture(uTexture, vTextureCoord);
    // -    fragColor = vec4(
    //   -      0.3+0.7*fBrightness * white_back,1.0);
    vec3 shaded_back  = 0.3+0.7*vec3(fBrightness);
    vec3 shaded_front = 0.3+0.7*fBrightness * sampled.rgb;
    float front_alpha =sampled.a; 
    fragColor = vec4(shaded_front*front_alpha+shaded_back*(1.0-front_alpha), 1.0);
    //fragColor = vec4(white_back,1.0);
}
`


export const FS_SOURCE_MIRRORS = `precision mediump float;
in vec2 vTextureCoord;
in float fBrightness;

out vec4 fragColor;
uniform sampler2D uTexture;

void main(void) {
  fragColor = vec4(vec3(0.5,0.9,1.0)*fBrightness,0.5);
}
`
export const VS_SOURCE_OVERLAY = `in vec3 aVertexPosition;
in vec2 aTextureCoord;

out vec2 vTextureCoord;

void main(void) {

  gl_Position = vec4(aVertexPosition, 1.0);
  vTextureCoord = aTextureCoord;

}
`
export const FS_SOURCE_OVERLAY = `precision mediump float;
in vec2 vTextureCoord;

out vec4 fragColor;
uniform sampler2D uTexture;
uniform float uOpacity;

void main(void) {
  vec4 sampled = texture(uTexture, vTextureCoord);
  fragColor = vec4(sampled.rgb, sampled.a * uOpacity);
}
`