// The plane maths moved to core, where sketch anchoring and extrude defaults
// also need it. Re-exported so face picking still reads as one module.
export { AXIS_ALIGNMENT_TOLERANCE, classifyFaceNormal, projectToSketchPlane, sketchPlaneOffset, type FaceOrientation } from '../core/sketch-plane'

