import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ViewCube } from './ViewCube'

describe('ViewCube Component', () => {
  it('renders without crashing in testing environment', () => {
    const { container } = render(<ViewCube />)
    expect(container.querySelector('.view-controls')).not.toBeNull()
    expect(container.querySelector('.view-cube-canvas')).not.toBeNull()
    expect(container.querySelector('.view-cube-quick-actions')).not.toBeNull()
  })
})
