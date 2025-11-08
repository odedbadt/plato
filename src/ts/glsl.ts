export const VS_SOURCE = `#version 300 es
precision mediump float;

uniform int numVerts;
in vec4 aVertexColor;
in vec3 aVertexPosition;
in vec3 aNormalDirection;
in vec2 aTextureCoord;
in float aVectorIndex;
out vec2 vTextureCoord;
out float vectorIndex;
out float fBrightness;
out vec4 oVertexColor;

out lowp vec4 vColor;
uniform mat3 model_transformer;
uniform mat4 projector;
uniform mat4 view;


vec3 lightDirection = vec3(-1.0,0.4,-1.0);

void main(void) {

  vec4 projected = projector* vec4(model_transformer * aVertexPosition, 1.0);
  vec3 normal_after_rotation = model_transformer * aNormalDirection;
  gl_Position = projected;
  //gl_Position = vec4(aVertexPosition, 1.0);
  oVertexColor = aVertexColor;
  vTextureCoord = aTextureCoord;
  vectorIndex = floor(float(gl_VertexID)/3.0);
  fBrightness = 0.7+0.3*dot(normalize(normal_after_rotation), 
                            normalize(lightDirection));
}
`
export const FS_SOURCE = `#version 300 es
precision mediump float;
in vec2 vTextureCoord;
in float fBrightness;
in float vectorIndex;
in vec4 oVertexColor;

out vec4 fragColor;
uniform sampler2D uTexture;

void main(void) {
    fragColor = vec4(
      0.3+0.7*fBrightness * texture(uTexture, vTextureCoord).rgb,1.0);
}
`

export const FS_SOURCE_NO_TEXTURE = `#version 300 es
precision mediump float;
in vec2 vTextureCoord;
in float fBrightness;
in float vectorIndex;
in vec4 oVertexColor;

out vec4 fragColor;

void main(void) {
  float fVectorIndex = min(float(vectorIndex),256.0)/256.0;
    fragColor = fBrightness * vec4(1.0,1.0,1.0,1.0);
    //fragColor = vec4(1.0,1.0,1.0,1.0);
}
`

export const FS_SOURCE_FEEDBACK = `#version 300 es
precision mediump float;
in vec2 vTextureCoord;
in float fBrightness;
uniform sampler2D uTexture;
in float vectorIndex;

out vec4 fragColor;

void main(void) {
  float fVectorIndex = min(vectorIndex,256.0)/256.0;
  fragColor = vec4(fVectorIndex,0.0,1.0,1.0);
  if (vectorIndex <= 256.0) {
     fragColor = vec4(0.0,1.0,0.0,1.0);
  } else {
     fragColor = vec4(0.0,0.0,1.0,1.0);
  }
  //fragColor = vec4(vTextureCoord,1.0,1.0);
  fragColor = vec4(fVectorIndex,fVectorIndex,fVectorIndex,1.0);

}
`

export const FS_SOURCE_MIRRORS = `#version 300 es
precision mediump float;
in vec2 vTextureCoord;
in float fBrightness;
in float vectorIndex;
in vec4 oVertexColor;

out vec4 fragColor;
uniform sampler2D uTexture;

void main(void) {
  fragColor = vec4(vec3(0.5,0.9,1.0)*fBrightness,0.5);
}
`
export const VS_SOURCE_OVERLAY = `#version 300 es
in vec3 aVertexPosition;
in vec2 aTextureCoord;

out vec2 vTextureCoord;

void main(void) {

  gl_Position = vec4(aVertexPosition, 1.0);
  vTextureCoord = aTextureCoord;

}
`
export const FS_SOURCE_OVERLAY = `#version 300 es
precision mediump float;
in vec2 vTextureCoord;
in float fBrightness;
in float vectorIndex;
in vec4 oVertexColor;

out vec4 fragColor;
uniform sampler2D uTexture;

void main(void) {
  fragColor = texture(uTexture, vTextureCoord);

  //fragColor = vec4(0.0,1.0,0.0,1.0);
}
`