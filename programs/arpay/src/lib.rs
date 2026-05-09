use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("8TySTE3dpxVBU9dBkVxG9Lesk4N57om8Bo94aeZJS2zF");

// ── Constants ────────────────────────────────────────────────────────────────

/// Maximum escrow window before eco-sponsor can claim a permissionless refund.
pub const ESCROW_TIMEOUT_SECONDS: i64 = 120;

/// Default slippage tolerance: 50 basis points (0.5%).
pub const SLIPPAGE_BPS: u64 = 50;
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Maximum acceptable age (seconds) for the Pyth price to be considered fresh.
/// Kept for future mainnet integration.
pub const MAX_PRICE_AGE_SECONDS: u64 = 10;

/// Protocol authority pubkey — replace with your authority keypair pubkey.
pub const PROTOCOL_AUTHORITY: Pubkey = pubkey!("6a6aMs2nRHLEVAvsq2tXaRkij87ntHQGabphQAYcFesF");

// ── Program ──────────────────────────────────────────────────────────────────

#[program]
pub mod arpay {
    use super::*;

    /// `initiate_settlement`
    ///
    /// Called by the eco-sponsor to lock USDC into a PDA escrow and emit the
    /// `SettlementRequested` event that the oracle bridge listens for.
    ///
    /// # Arguments
    /// * `community_id`  – QRIS NMID of the destination community hub.
    /// * `usdc_amount`   – Amount of USDC (6 decimals) to lock.
    /// * `idr_amount`    – Expected IDR disbursement amount (minor units).
    /// * `nonce`         – Monotonically increasing per-sponsor nonce; ensures
    ///                     PDA uniqueness and prevents replay attacks.
    /// * `client_rate`   – Client-side USDC/IDR rate encoded as u64 integer
    ///                     (e.g. 16_345 = 1 USDC → 16,345 IDR).
    pub fn initiate_settlement(
        ctx: Context<InitiateSettlement>,
        community_id: String,
        usdc_amount: u64,
        idr_amount: u64,
        nonce: u64,
        client_rate: u64,
    ) -> Result<()> {
        // ── 1. Validate input bounds ──────────────────────────────────────
        require!(usdc_amount > 0, ArPayError::ZeroAmount);
        require!(idr_amount > 0, ArPayError::ZeroAmount);
        require!(!community_id.is_empty(), ArPayError::EmptyCommunityId);
        require!(community_id.len() <= 64, ArPayError::CommunityIdTooLong);

        // NOTE: Pyth on-chain price validation is skipped for devnet.
        // client_rate is stored in escrow for off-chain oracle reconciliation.
        let _ = client_rate;

        // ── 2. Transfer USDC from sponsor → PDA escrow ───────────────────
        let cpi_accounts = Transfer {
            from: ctx.accounts.sponsor_token_account.to_account_info(),
            to: ctx.accounts.escrow_token_account.to_account_info(),
            authority: ctx.accounts.sponsor.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        token::transfer(cpi_ctx, usdc_amount)?;

        // ── 3. Write escrow state ─────────────────────────────────────────
        let clock = Clock::get()?;
        let escrow_key = ctx.accounts.escrow.key();
        let sponsor_key = ctx.accounts.sponsor.key();
        let escrow = &mut ctx.accounts.escrow;

        escrow.sponsor = sponsor_key;
        escrow.community_id = community_id.clone();
        escrow.usdc_amount = usdc_amount;
        escrow.idr_amount = idr_amount;
        escrow.client_rate = client_rate;
        escrow.nonce = nonce;
        escrow.created_at = clock.unix_timestamp;
        escrow.status = EscrowStatus::Pending;
        escrow.bump = ctx.bumps.escrow;

        let community_id_log = escrow.community_id.clone();

        // ── 4. Emit settlement-requested event ────────────────────────────
        emit!(SettlementRequested {
            community_id,
            idr_amount,
            usdc_amount,
            payer: sponsor_key,
            nonce,
            timestamp: clock.unix_timestamp,
            escrow: escrow_key,
        });

        msg!(
            "ArPay: settlement initiated | sponsor={} community={} usdc={} idr={} nonce={}",
            sponsor_key,
            community_id_log,
            usdc_amount,
            idr_amount,
            nonce,
        );

        Ok(())
    }

    /// `release_escrow`
    ///
    /// Called by the ArPay authority after confirmed BI-FAST disbursement.
    /// Moves escrowed USDC to the protocol treasury and marks the escrow as
    /// released.
    pub fn release_escrow(
        ctx: Context<ReleaseEscrow>,
        settlement_id: String,
    ) -> Result<()> {
        let escrow_key = ctx.accounts.escrow.key();
        let escrow = &mut ctx.accounts.escrow;

        require!(
            escrow.status == EscrowStatus::Pending,
            ArPayError::EscrowAlreadySettled
        );

        // Transfer USDC from escrow → treasury
        let seeds = &[
            b"escrow",
            escrow.sponsor.as_ref(),
            escrow.community_id.as_bytes(),
            &escrow.nonce.to_le_bytes(),
            &[escrow.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            to: ctx.accounts.treasury_token_account.to_account_info(),
            authority: escrow.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, escrow.usdc_amount)?;

        let community_id_log = escrow.community_id.clone();
        let usdc_log = escrow.usdc_amount;
        let idr_log = escrow.idr_amount;

        escrow.status = EscrowStatus::Released;

        emit!(EscrowReleased {
            escrow: escrow_key,
            settlement_id,
            community_id: community_id_log,
            usdc_amount: usdc_log,
            idr_amount: idr_log,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!(
            "ArPay: escrow released | community={} usdc={}",
            escrow.community_id,
            escrow.usdc_amount,
        );

        Ok(())
    }

    /// `refund_escrow`
    ///
    /// Permissionless refund path. Anyone can call this after the timeout
    /// window has passed and the escrow is still in `Pending` state.
    pub fn refund_escrow(ctx: Context<RefundEscrow>) -> Result<()> {
        let escrow_key = ctx.accounts.escrow.key();
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        require!(
            escrow.status == EscrowStatus::Pending,
            ArPayError::EscrowAlreadySettled
        );
        require!(
            clock.unix_timestamp >= escrow.created_at + ESCROW_TIMEOUT_SECONDS,
            ArPayError::EscrowNotExpired
        );

        let seeds = &[
            b"escrow",
            escrow.sponsor.as_ref(),
            escrow.community_id.as_bytes(),
            &escrow.nonce.to_le_bytes(),
            &[escrow.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            to: ctx.accounts.sponsor_token_account.to_account_info(),
            authority: escrow.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, escrow.usdc_amount)?;

        let sponsor_log = escrow.sponsor;
        let usdc_log = escrow.usdc_amount;

        escrow.status = EscrowStatus::Refunded;

        emit!(EscrowRefunded {
            escrow: escrow_key,
            sponsor: sponsor_log,
            usdc_amount: usdc_log,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "ArPay: escrow refunded | sponsor={} usdc={}",
            sponsor_log,
            usdc_log,
        );

        Ok(())
    }
}

// ── Account Contexts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(community_id: String, usdc_amount: u64, idr_amount: u64, nonce: u64)]
pub struct InitiateSettlement<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,

    /// PDA escrow account — derived from (b"escrow", sponsor, community_id, nonce).
    #[account(
        init,
        payer = sponsor,
        space = EscrowAccount::LEN,
        seeds = [
            b"escrow",
            sponsor.key().as_ref(),
            community_id.as_bytes(),
            &nonce.to_le_bytes(),
        ],
        bump,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    /// Sponsor's USDC associated token account (source of funds).
    #[account(
        mut,
        constraint = sponsor_token_account.owner == sponsor.key(),
        constraint = sponsor_token_account.amount >= usdc_amount @ ArPayError::InsufficientFunds,
    )]
    pub sponsor_token_account: Account<'info, TokenAccount>,

    /// PDA-controlled USDC token account that holds funds during escrow.
    #[account(
        init_if_needed,
        payer = sponsor,
        token::mint = usdc_mint,
        token::authority = escrow,
        seeds = [b"escrow_token", escrow.key().as_ref()],
        bump,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// CHECK: USDC mint address, validated implicitly by TokenAccount constraints.
    pub usdc_mint: UncheckedAccount<'info>,

    /// CHECK: Pyth price feed — skipped for devnet, will be validated on mainnet.
    pub price_update: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(settlement_id: String)]
pub struct ReleaseEscrow<'info> {
    /// Must match the PROTOCOL_AUTHORITY pubkey.
    #[account(
        constraint = authority.key() == PROTOCOL_AUTHORITY @ ArPayError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"escrow",
            escrow.sponsor.as_ref(),
            escrow.community_id.as_bytes(),
            &escrow.nonce.to_le_bytes(),
        ],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        mut,
        seeds = [b"escrow_token", escrow.key().as_ref()],
        bump,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub treasury_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RefundEscrow<'info> {
    /// Permissionless — anyone can trigger after timeout.
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"escrow",
            escrow.sponsor.as_ref(),
            escrow.community_id.as_bytes(),
            &escrow.nonce.to_le_bytes(),
        ],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        mut,
        seeds = [b"escrow_token", escrow.key().as_ref()],
        bump,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// Must match the original sponsor stored in the escrow.
    #[account(
        mut,
        constraint = sponsor_token_account.owner == escrow.sponsor @ ArPayError::Unauthorized,
    )]
    pub sponsor_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ── State ─────────────────────────────────────────────────────────────────────

#[account]
pub struct EscrowAccount {
    /// Original eco-sponsor public key (used for refund routing).
    pub sponsor: Pubkey,
    /// QRIS NMID of the target community hub (max 64 bytes).
    pub community_id: String,
    /// USDC amount locked (6 decimal places).
    pub usdc_amount: u64,
    /// IDR amount to be disbursed (minor units, i.e. integer Rupiah).
    pub idr_amount: u64,
    /// Client-side rate at time of initiation (IDR per USDC, integer).
    pub client_rate: u64,
    /// Monotonic nonce — ensures PDA uniqueness per sponsor.
    pub nonce: u64,
    /// Unix timestamp of escrow creation.
    pub created_at: i64,
    /// Current lifecycle status.
    pub status: EscrowStatus,
    /// PDA bump seed.
    pub bump: u8,
}

impl EscrowAccount {
    // discriminator(8) + pubkey(32) + string_prefix(4) + community_id(64)
    // + u64*4(32) + i64(8) + enum(1) + bump(1) = 150 + padding
    pub const LEN: usize = 8 + 32 + 4 + 64 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 32;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum EscrowStatus {
    Pending,
    Released,
    Refunded,
}

// ── Events ────────────────────────────────────────────────────────────────────

/// Emitted by `initiate_settlement` — the oracle bridge subscribes to this.
#[event]
pub struct SettlementRequested {
    pub community_id: String,
    pub idr_amount: u64,
    pub usdc_amount: u64,
    pub payer: Pubkey,
    pub nonce: u64,
    pub timestamp: i64,
    pub escrow: Pubkey,
}

#[event]
pub struct EscrowReleased {
    pub escrow: Pubkey,
    pub settlement_id: String,
    pub community_id: String,
    pub usdc_amount: u64,
    pub idr_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct EscrowRefunded {
    pub escrow: Pubkey,
    pub sponsor: Pubkey,
    pub usdc_amount: u64,
    pub timestamp: i64,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum ArPayError {
    #[msg("USDC amount must be greater than zero")]
    ZeroAmount,
    #[msg("Community ID cannot be empty")]
    EmptyCommunityId,
    #[msg("Community ID exceeds maximum length of 64 characters")]
    CommunityIdTooLong,
    #[msg("Sponsor token account has insufficient USDC balance")]
    InsufficientFunds,
    #[msg("Pyth price feed account is invalid")]
    InvalidPriceFeed,
    #[msg("Pyth price is stale — age exceeds MAX_PRICE_AGE_SECONDS")]
    StalePriceFeed,
    #[msg("Spot price deviates beyond slippage tolerance (0.5%)")]
    SlippageExceeded,
    #[msg("Escrow has already been settled or refunded")]
    EscrowAlreadySettled,
    #[msg("Escrow timeout has not yet elapsed")]
    EscrowNotExpired,
    #[msg("Caller is not the ArPay protocol authority")]
    Unauthorized,
    #[msg("Arithmetic overflow in price normalisation")]
    MathOverflow,
}