interface ErrorDefinition {
    status: number;
    message: string;
    record?: boolean;
}

export const ERRORS = {
    INVALID_REQUEST: { status: 400, message: 'Requisição inválida.' },
    INVALID_CREDENTIALS: { status: 401, message: 'E-mail ou senha inválidos.' },
    ACCOUNT_DISABLED: { status: 403, message: 'Conta desativada.' },
    MFA_UNSUPPORTED: {
        status: 403,
        message: 'Contas com verificação em duas etapas ainda não são suportadas.',
    },
    ORIGIN_NOT_ALLOWED: { status: 403, message: 'Origem não permitida.' },
    NOT_FOUND: { status: 404, message: 'Recurso não encontrado.' },
    INTERACTION_EXPIRED: { status: 410, message: 'O login expirou. Recomece pelo produto.' },
    LOGOUT_EXPIRED: { status: 410, message: 'Não há logout pendente.' },
    PASSWORD_CODE_INVALID: {
        status: 410,
        message: 'O link para criar a senha expirou ou já foi usado.',
    },
    WEAK_PASSWORD: { status: 400, message: 'Senha fraca. Escolha uma senha mais forte.' },
    TOO_MANY_ATTEMPTS: { status: 429, message: 'Muitas tentativas. Aguarde e tente novamente.' },
    HTTP_ERROR: { status: 400, message: 'Não foi possível concluir a requisição.' },
    INTERNAL_ERROR: { status: 500, message: 'Erro interno no servidor.' },
    AUTH_UNAVAILABLE: {
        status: 503,
        message: 'Autenticação indisponível no momento. Tente novamente.',
    },
    NOT_READY: { status: 503, message: 'Serviço ainda não está pronto.', record: false },
} satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERRORS;

export function errorDefinition(code: ErrorCode): ErrorDefinition {
    return ERRORS[code];
}
