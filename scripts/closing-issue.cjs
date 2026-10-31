function parseClosingIssue(body, currentRepository) {
    if (typeof body !== 'string') throw new Error('PR body must contain one Closes directive.');
    const text = body
        .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
        .replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    let fence;
    const directives = [];
    for (const line of text.split(/\r?\n/)) {
        const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (fence) {
            if (
                marker &&
                marker[1][0] === fence[0] &&
                marker[1].length >= fence.length &&
                line.trim() === marker[1]
            )
                fence = undefined;
            continue;
        }
        if (marker) {
            fence = marker[1];
            continue;
        }
        if (/^(?: {4}|\t)/.test(line)) continue;
        if (/^Closes\b/i.test(line.trim())) directives.push(line.trim());
    }
    if (directives.length !== 1) throw new Error('Use exactly one Closes #N directive per PR.');
    const match = /^Closes:?\s+(?:([a-z0-9_.-]+\/[a-z0-9_.-]+))?#([1-9]\d*)$/i.exec(directives[0]);
    if (!match) throw new Error('Invalid Closes directive.');
    const repository = match[1] || currentRepository;
    if (repository.toLowerCase() !== currentRepository.toLowerCase()) {
        throw new Error('Cross-repository closure requires a separately authorized integration.');
    }
    const number = Number(match[2]);
    if (!Number.isSafeInteger(number)) throw new Error('Invalid issue number.');
    const [owner, repo] = currentRepository.split('/');
    return { owner, repo, issue_number: number };
}

async function closeLinkedIssue({ payload, repository, getIssue, closeIssue }) {
    const pr = payload.pull_request;
    if (payload.action !== 'closed' || pr?.merged !== true || pr.base?.ref !== 'develop')
        return 'skipped';
    const reference = parseClosingIssue(pr.body, repository);
    const issue = await getIssue(reference);
    if (issue.pull_request) throw new Error('Closes must reference an issue, not a pull request.');
    if (issue.state === 'closed') return 'already-closed';
    await closeIssue({ ...reference, state: 'closed', state_reason: 'completed' });
    return 'closed';
}

module.exports = { parseClosingIssue, closeLinkedIssue };
