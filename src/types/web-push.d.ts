declare module 'web-push' {
  const webPush: {
    generateVAPIDKeys(): { publicKey: string; privateKey: string };
    sendNotification(
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
      payload: string,
      options: {
        vapidDetails: { subject: string; publicKey: string; privateKey: string };
        TTL: number;
        timeout: number;
      },
    ): Promise<{ statusCode: number }>;
  };
  export default webPush;
}
