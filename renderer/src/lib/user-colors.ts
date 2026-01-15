const USER_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#9333ea',
  '#ea580c',
  '#0f766e',
  '#0f172a'
]

export function colorFromKey(key: string) {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash + key.charCodeAt(i) * 17) % 9973
  }
  return USER_COLORS[hash % USER_COLORS.length]
}
