export function convertToDirectUrl(proxiedUrl) {
    const patterns = [
      {
        pattern: /https:\/\/vidlink\.pro\/api\/proxy\/([^\/]+)\/(.+)$/,
        convert: (id, path) => `https://cdn.vidlink.pro/${id}/${path}`
      },
      {
        pattern: /https:\/\/movieclub\.cloud\/api\/proxy\/([^\/]+)\/(.+)$/,
        convert: (id, path) => `https://cdn.movieclub.cloud/${id}/${path}`
      },
      {
        pattern: /https:\/\/vidbinge\.dev\/api\/proxy\/([^\/]+)\/(.+)$/,
        convert: (id, path) => `https://cdn.vidbinge.dev/${id}/${path}`
      }
    ];
  
    try {
      for (const { pattern, convert } of patterns) {
        const match = proxiedUrl.match(pattern);
        if (match) {
          const [_, id, path] = match;
          return convert(id, path);
        }
      }
      return proxiedUrl;
    } catch (error) {
      console.error('URL conversion error:', error);
      return proxiedUrl;
    }
  }