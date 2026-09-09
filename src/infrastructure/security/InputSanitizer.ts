export class InputSanitizer {
  static sanitizeString(input: string): string {
    // Remove potential XSS vectors
    return input
      .replace(/[<>]/g, '') // Remove < and >
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
      .trim()
      .slice(0, 5000); // Limit length
  }

  static sanitizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  static validateUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  static validatePageSize(limit: number): number {
    const maxLimit = 100;
    const minLimit = 1;
    if (limit < minLimit) return minLimit;
    if (limit > maxLimit) return maxLimit;
    return limit;
  }

  static validatePage(page: number): number {
    const minPage = 1;
    if (page < minPage) return minPage;
    return page;
  }
}
