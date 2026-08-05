export const auctionPath = (code) =>
  `/${encodeURIComponent(String(code).toUpperCase())}`;

export const auctionUrl = (code) => location.origin + auctionPath(code);

export const adminAccessUrl = (code, token) =>
  `${auctionUrl(code)}#admin=${encodeURIComponent(token)}`;
