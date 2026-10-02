import { describe, expect, it } from 'vitest'
import { fileTypeLabel, formatFileSize, isImage, linkSource, linkTitle, normalizeLink } from '../../src/app/lib/attachments'

describe('event attachments', () => {
  it('accepts web addresses and adds https to a bare domain', () => {
    expect(normalizeLink(' https://www.figma.com/deck/abc ')).toBe('https://www.figma.com/deck/abc')
    expect(normalizeLink('docs.google.com/presentation/d/1')).toBe('https://docs.google.com/presentation/d/1')
    expect(normalizeLink('javascript:alert(1)')).toBeNull()
    expect(normalizeLink('order notes for friday')).toBeNull()
    expect(normalizeLink('')).toBeNull()
  })

  it('names where a link points', () => {
    expect(linkSource('https://www.figma.com/deck/abc/Slides')).toBe('Figma')
    expect(linkSource('https://docs.google.com/presentation/d/1/edit')).toBe('Google Slides')
    expect(linkSource('https://docs.google.com/spreadsheets/d/1')).toBe('Google Sheets')
    expect(linkSource('https://docs.google.com/document/d/1')).toBe('Google Docs')
    expect(linkSource('https://drive.google.com/file/d/1')).toBe('Google Drive')
    expect(linkSource('https://www.example.org/orders/42')).toBe('example.org')
  })

  it('titles a Figma link with its file name and others with their source', () => {
    expect(linkTitle('https://www.figma.com/deck/AbC123/Fall-Screening-slides?node-id=1')).toBe('Fall Screening slides')
    expect(linkTitle('https://www.figma.com/design/AbC123')).toBe('Figma')
    expect(linkTitle('https://docs.google.com/presentation/d/1/edit')).toBe('Google Slides')
  })

  it('labels files by type and size', () => {
    expect(fileTypeLabel('Partnership agreement.pdf')).toBe('PDF')
    expect(fileTypeLabel('pasted', 'image/png')).toBe('Image')
    expect(isImage('receipt.JPG')).toBe(true)
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(245760)).toBe('240 KB')
    expect(formatFileSize(3.5 * 1024 * 1024)).toBe('3.5 MB')
    expect(formatFileSize(null)).toBe('')
  })
})
