import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { App } from './App'

vi.mock('../viewport/SceneViewport', () => ({
  SceneViewport: () => React.createElement('div', { 'data-testid': 'mock-viewport' }),
}))

describe('App Component Integration', () => {
  it('renders application shell with initial workspace state', () => {
    render(React.createElement(App))
    expect(screen.getByText('PARALLAX')).toBeDefined()
    expect(screen.getByText('FEATURES')).toBeDefined()
    expect(screen.getByText('PROPERTIES')).toBeDefined()
    expect(screen.getByTestId('mock-viewport')).toBeDefined()
  })

  it('allows opening and closing the plane picker dialog', () => {
    render(React.createElement(App))
    const sketchButton = screen.getAllByTitle('Create sketch')[0]
    fireEvent.click(sketchButton)

    expect(screen.getByRole('dialog', { name: 'Choose a sketch plane' })).toBeDefined()

    const closeButton = screen.getByLabelText('Close Choose a sketch plane')
    fireEvent.click(closeButton)

    expect(screen.queryByRole('dialog', { name: 'Choose a sketch plane' })).toBeNull()
  })

  it('allows toggling measurement mode and pressing Escape to exit', () => {
    render(React.createElement(App))
    const measureButton = screen.getAllByTitle('Measure points and features')[0]
    fireEvent.click(measureButton)

    fireEvent.keyDown(window, { key: 'Escape' })
  })
})
