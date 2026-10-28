// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Page from '../../app/page';

describe('app shell', () => {
  it('renders the page heading', () => {
    render(<Page />);
    expect(screen.getByRole('heading', { name: 'Employee Time Tracker' })).toBeTruthy();
  });
});
