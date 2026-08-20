/**
 * Geometric tolerance policy, in millimetres unless the name says otherwise.
 *
 * These values answer different questions and deliberately are not one global
 * epsilon. Reference anchors must fail safely before they attach to a nearby
 * feature, while viewport face ownership may be slightly more forgiving
 * because a missed highlight cannot alter the model. Coplanarity is tighter
 * again so a shallow curved surface is not offered as a sketch plane.
 */

/** Re-deriving persisted edge and face anchors from parametric geometry. */
export const ANCHOR_MATCH_DISTANCE_MM = 0.05

/** Attributing tessellated face samples for selection highlighting only. */
export const FACE_OWNERSHIP_DISTANCE_MM = 0.08

/** Classifying tessellated triangles as one planar face. */
export const COPLANAR_FACE_DISTANCE_MM = 0.02

/** Matching a selected B-rep edge's midpoint; this is a squared-distance score. */
export const FILLET_EDGE_POINT_SCORE_MM2 = 0.04

/** Sum of the two endpoint squared distances for a persisted fillet edge. */
export const FILLET_EDGE_ENDPOINT_SCORE_MM2 = 0.08

/** Maximum squared deviation from a sharp source edge's infinite line. */
export const FILLET_SOURCE_LINE_DISTANCE_MM2 = 0.04

/** Squared chord deviation above which an edge is treated as curved. */
export const FILLET_CURVE_CHORD_DISTANCE_MM2 = 0.01

/** Connecting adjacent edges during tangent-chain propagation. */
export const FILLET_VERTEX_DISTANCE_MM = 0.05

/** Clustering a corner's tessellated endpoints when completing corner blends. */
export const FILLET_CORNER_CLUSTER_DISTANCE_MM = 0.1

/**
 * Accepting a sketch curve intersection as a point both curves pass through.
 *
 * Looser than the anchor tolerances above because sketch geometry is solved
 * numerically: two lines a solver has just made meet at a corner can sit a
 * solver residual apart, and a trim that failed to notice that would leave a
 * hair-thin sliver behind instead of cutting the corner.
 */
export const SKETCH_INTERSECTION_DISTANCE_MM = 1e-6

/**
 * The shortest piece a trim will leave behind.
 *
 * A remnant below this is discarded rather than kept, so trimming exactly at an
 * endpoint does not leave a zero-length entity that no user can see, select or
 * delete — but which still reaches the solver and the profile finder.
 */
export const SKETCH_TRIM_MIN_PIECE_MM = 1e-4
