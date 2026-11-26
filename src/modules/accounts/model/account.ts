export interface Account {
    sub: string;
    claims: Record<string, unknown>;
}

export interface LoadOptions {
    firebaseClaims: string[];
    authTime?: number;
}
