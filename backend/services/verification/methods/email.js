// ADR-0011 · Phase C · Email method plugin — stub.
//
// Real implementation requires a transactional email sender + pending-code
// store. Scheduled for Phase D. Until then, returns method_not_implemented.

export const emailMethod = {
  name: 'email',
  async verify() {
    return {
      ok: false,
      code: 'method_not_implemented',
      message: 'Email method is not yet implemented',
      status: 501,
    };
  },
};
