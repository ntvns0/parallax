/**
 * Decides whether the viewport needs to draw this animation frame.
 *
 * Drawing every frame keeps a GPU busy — ambient occlusion included — while
 * nothing on screen changes, which costs battery on a laptop or phone and makes
 * software rendering crawl. A frame is drawn only when the camera moved or
 * something asked for one: a scene change, an input event, a resize.
 *
 * Requests made while a frame is being drawn carry over to the next one, so a
 * change that lands mid-frame is never lost.
 */
export class FrameScheduler {
  private requested = true

  /** Ask for a frame. Cheap enough to call on every pointer move. */
  request(): void {
    this.requested = true
  }

  /**
   * Called once per animation frame. Returns whether to draw, and consumes the
   * pending request when it does.
   */
  shouldDraw(cameraMoved: boolean): boolean {
    if (!cameraMoved && !this.requested) return false
    this.requested = false
    return true
  }
}
