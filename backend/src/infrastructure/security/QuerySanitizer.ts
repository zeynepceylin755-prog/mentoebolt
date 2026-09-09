export class QuerySanitizer {
  static sanitizeOrderBy(orderBy: string | undefined, allowedFields: string[]): string | undefined {
    if (!orderBy) return undefined;
    if (!allowedFields.includes(orderBy)) {
      throw new Error(`Invalid order by field: ${orderBy}`);
    }
    return orderBy;
  }

  static sanitizeSortDirection(direction: string | undefined): 'asc' | 'desc' {
    if (!direction) return 'asc';
    if (direction.toLowerCase() === 'desc') return 'desc';
    return 'asc';
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

  static sanitizeSearchTerm(search: string): string {
    // Remove SQL wildcard characters
    return search
      .replace(/%/g, '')
      .replace(/_/g, '')
      .trim()
      .slice(0, 100);
  }
}
