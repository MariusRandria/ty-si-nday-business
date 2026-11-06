self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Ty sy Nday Business', body: event.data.text() }
  }

  const notificationId = Number(payload.notificationId)
  event.waitUntil(self.registration.showNotification(payload.title || 'Ty sy Nday Business', {
    body: payload.body || 'Une nouvelle notification vous attend.',
    icon: '/notification-icon-192.png',
    badge: '/notification-icon-192.png',
    tag: Number.isInteger(notificationId) ? `notification-${notificationId}` : undefined,
    data: { notificationId },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const notificationId = Number(event.notification.data?.notificationId)
  if (!Number.isInteger(notificationId)) return

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      if (new URL(client.url).origin !== self.location.origin) continue
      await client.focus()
      client.postMessage({ type: 'PUSH_NOTIFICATION_CLICK', notificationId })
      return
    }

    await self.clients.openWindow(`/?pushNotificationId=${notificationId}`)
  })())
})
