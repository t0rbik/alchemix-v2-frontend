<script>
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { _ } from 'svelte-i18n';
  import { utils, BigNumber } from 'ethers';

  import Button from '@components/elements/Button.svelte';
  import ComplexInput from '../../../composed/Inputs/ComplexInput.svelte';
  import MaxLossController from '@components/composed/MaxLossController.svelte';
  import ToggleSwitch from '@components/elements/ToggleSwitch.svelte';
  import VaultMessage from '@components/elements/VaultMessage.svelte';

  import { deposit, depositUnderlying, multicallDeposit, getVaultMaxLoss } from '@stores/v2/vaultActions';
  import { VaultTypes } from '@stores/v2/types';
  import {
    addressStore,
    balancesStore,
    vaultsStore,
    adaptersStore,
    networkStore,
  } from '@stores/v2/alcxStore';
  import { signer } from '@stores/v2/derived';
  import {
    fetchBalanceByAddress,
    fetchUpdateVaultByAddress,
    fetchAdaptersForVaultType,
  } from '@stores/v2/asyncMethods';
  import { getTokenDataFromBalances, getTokenDataFromBalancesBySymbol } from '@stores/v2/helpers';
  import { modalReset } from '@stores/modal';
  import settings from '@stores/settings';
  import { VaultTypesInfos } from '@stores/v2/constants';

  export let borrowLimit;

  export let vault;
  export let capInfo;
  export let isPaused;

  let maximumLoss;

  let maxLossPreset;

  let yieldDeposit = 0;
  let underlyingDeposit = 0;
  let depositEth = false;
  $: yieldTokenData = initializeTokenDataForAddress(vault.yieldToken);

  $: adapterPrice = $adaptersStore[vault.type]?.adapters.filter(
    (adapter) => adapter.yieldToken === vault.address,
  )[0].price;

  const onButtonDeposit = async (_yieldDeposit, _underlyingDeposit) => {
    modalReset();

    await fetchAdaptersForVaultType(VaultTypes[VaultTypes[vault.type]], [$signer], $networkStore);
    const yieldTokens = underlyingDepositBN
      .mul(BigNumber.from(10).pow(underlyingTokenData.decimals))
      .div(adapterPrice);
    const subTokens = yieldTokens.mul(BigNumber.from(maximumLoss)).div(10000);
    const underlyingMinimumIn = yieldTokens.sub(subTokens);

    if (_yieldDeposit.gt(0) && _underlyingDeposit.gt(0)) {
      await multicallDeposit(
        vault.type,
        vault.address,
        vault.underlyingAddress,
        _underlyingDeposit,
        _yieldDeposit,
        BigNumber.from(maximumLoss),
        [$addressStore, $signer],
        underlyingMinimumIn,
        $networkStore,
      )
        .then(() => {
          Promise.all([
            fetchBalanceByAddress(vault.underlyingAddress, [$signer]),
            fetchBalanceByAddress(vault.address, [$signer]),
            fetchUpdateVaultByAddress(vault.type, vault.address, [$signer, $addressStore], $networkStore),
          ]).then(() => {
            console.log('[multicallDeposit/finished]: Balances and vault data updated!');
          });
        })
        .catch((e) => {
          const log = e.data ? e.data.message : e.message;
          console.error(log);
        })
        .finally(() => {
          yieldDeposit = 0;
          underlyingDeposit = 0;
        });
    } else if (_yieldDeposit.gt(0) && _underlyingDeposit.lte(0)) {
      await deposit(
        vault.yieldToken,
        vault.type,
        _yieldDeposit,
        BigNumber.from(adapterPrice),
        yieldTokenData?.decimals,
        [$addressStore, $signer],
        $networkStore,
        vault.address,
      )
        .then(() => {
          Promise.all([
            fetchBalanceByAddress(vault.yieldToken, [$signer]),
            fetchBalanceByAddress(vault.address, [$signer]),
            fetchUpdateVaultByAddress(vault.type, vault.address, [$signer, $addressStore], $networkStore),
          ]).then(() => {
            console.log('[deposit/finished]: Balances and vault data updated!');
          });
        })
        .catch((e) => {
          const log = e.data ? e.data.message : e.message;
          console.error(log);
        })
        .finally(() => {
          yieldDeposit = 0;
          underlyingDeposit = 0;
        });
    } else {
      await depositUnderlying(
        vault.underlyingAddress,
        vault.address,
        vault.type,
        _underlyingDeposit,
        yieldTokens,
        BigNumber.from(maximumLoss),
        BigNumber.from(adapterPrice),
        yieldTokenData?.decimals,
        [$addressStore, $signer],
        underlyingMinimumIn,
        $networkStore,
        depositEth ? 'eth' : vault.yieldToken,
        depositEth,
      )
        .then(() => {
          Promise.all([
            fetchBalanceByAddress(vault.underlyingAddress, [$signer]),
            fetchBalanceByAddress(vault.address, [$signer]),
            fetchUpdateVaultByAddress(vault.type, vault.address, [$signer, $addressStore], $networkStore),
          ]).then(() => {
            console.log('[depositUnderlying/finished]: Balances and vault data updated!');
          });
        })
        .catch((e) => {
          const log = e.data ? e.data.message : e.message;
          console.trace(`[onButtonDeposit/depositUnderlying]`, log);
        })
        .finally(() => {
          yieldDeposit = 0;
          underlyingDeposit = 0;
        });
    }
  };

  function initializeTokenDataForAddress(address) {
    if (vault) {
      return getTokenDataFromBalances(address, [$balancesStore]);
    }
  }

  $: ethData = getTokenDataFromBalances('0xETH', [$balancesStore]);
  $: underlyingTokenData = initializeTokenDataForAddress(vault.underlyingAddress);
  $: useGateway = vault.useGateway;

  function formatDepositToBN(_deposit, _tokenData) {
    if (_deposit && _tokenData) {
      return utils.parseUnits(`${_deposit}`, _tokenData.decimals);
    }

    return BigNumber.from(0);
  }

  $: yieldDepositBN = formatDepositToBN(yieldDeposit, yieldTokenData);
  $: underlyingDepositBN = formatDepositToBN(underlyingDeposit, depositEth ? ethData : underlyingTokenData);

  function initializeStartDebtLimit(borrowLimit, vault, _underlyingTokenData) {
    if (borrowLimit !== undefined && vault) {
      const _correctBorrowLimit = borrowLimit
        .mul(vault.underlyingPerShare)
        .div(BigNumber.from(10).pow(BigNumber.from(_underlyingTokenData.decimals).mul(2)));

      const _fcorrectBorrowLimit = parseFloat(_correctBorrowLimit.toString());

      return _fcorrectBorrowLimit;
    }

    return 0;
  }

  function calculateProjectedDebtLimit(
    _borrowLimit,
    _yieldDeposit,
    _underlyingDeposit,
    _yieldTokenData,
    _underlyingTokenData,
  ) {
    if (!_yieldTokenData || !_underlyingTokenData || !_borrowLimit || !_yieldDeposit || !_underlyingDeposit) {
      return undefined;
    }

    const _tokenDecimals = _underlyingTokenData.decimals + _yieldDeposit.gt(0) ? _yieldTokenData.decimals : 0;
    const total = _underlyingDeposit.add(_yieldDeposit).div(BigNumber.from(10).pow(_tokenDecimals));
    if (total.gt(0)) {
      const _correctBorrowLimit = _borrowLimit
        .mul(vault.underlyingPerShare)
        .div(BigNumber.from(10).pow(BigNumber.from(_underlyingTokenData.decimals).mul(2)));

      const _correctLoanRatio = $vaultsStore[vault.type].ratio.div(BigNumber.from(10).pow(18));

      const _fTotal = parseFloat(total.toString());
      const _fcorrectBorrowLimit = parseFloat(_correctBorrowLimit.toString());
      const _fCorrectLoanRatio = parseFloat(_correctLoanRatio.toString());

      return _fcorrectBorrowLimit + _fTotal / _fCorrectLoanRatio;
    } else {
      return undefined;
    }
  }

  function switchDepositType() {
    depositEth = !depositEth;
    underlyingDeposit = 0;
    yieldDeposit = 0;
  }

  $: startDebtLimit = initializeStartDebtLimit(borrowLimit, vault, underlyingTokenData);
  $: projDeptLimit = calculateProjectedDebtLimit(
    borrowLimit,
    yieldDepositBN,
    underlyingDepositBN,
    yieldTokenData,
    underlyingTokenData,
  );

  $: depositButtonDisabled =
    maximumLoss / 1000 >= 100 ||
    !yieldDepositBN.add(underlyingDepositBN).gt(0) ||
    yieldDepositBN.gt(yieldTokenData.balance) ||
    underlyingDepositBN.gt(depositEth ? ethData.balance : underlyingTokenData.balance);
  $: metaConfig = VaultTypesInfos[vault.type].metaConfig[vault.address] || false;
  $: acceptGateway = metaConfig.acceptGateway;
  $: acceptWETH = metaConfig.acceptWETH;
  $: supportedTokens =
    vault.type === 1 && metaConfig
      ? acceptWETH
        ? [yieldTokenData?.symbol, underlyingTokenData?.symbol]
        : [yieldTokenData?.symbol]
      : [yieldTokenData?.symbol, underlyingTokenData?.symbol];
  $: ethTokens = depositEth ? ethData?.symbol : underlyingTokenData?.symbol;
  $: yieldTokenSymbol = metaConfig.token || yieldTokenData?.symbol;
  let activeInputs = 1;
  const selection = writable();
  let _selection;
  selection.subscribe((val) => {
    _selection = val;
  });
  $: if (supportedTokens.length >= 1) {
    selection.set(
      supportedTokens?.map((token) => {
        return {
          token: token,
          selected: false,
        };
      }),
    );
  }
  $: canAddInputs = metaConfig
    ? activeInputs < supportedTokens?.length && metaConfig.multicall
    : activeInputs < supportedTokens?.length;
  const addInputs = (token) => {
    _selection.find((entry) => entry.token === token).selected = true;
    selection.set(_selection);
    activeInputs += 1;
  };
  let selectedTokens = [];
  let inputValues = {};
  $: if (inputValues) {
    if (inputValues[underlyingTokenData.symbol]) underlyingDeposit = inputValues[underlyingTokenData.symbol];
    if (inputValues[yieldTokenData?.symbol]) yieldDeposit = inputValues[yieldTokenData?.symbol];
  }
  $: capa = capInfo.capacity.value;

  const capaToUnits = (_capa, _token) => {
    const tokenData = getTokenDataFromBalancesBySymbol(_token, [$balancesStore]);
    return utils.parseUnits(utils.formatUnits(_capa, underlyingTokenData.decimals), tokenData.decimals);
  };

  onMount(async () => {
    if (vault) {
      maxLossPreset = await getVaultMaxLoss(vault.address, vault.type, [$signer], $networkStore);
    }
  });
</script>

{#if vault}
  {#if metaConfig ? acceptGateway && vault.type === 1 : useGateway}
    <div class="text-sm text-lightgrey10 w-full flex flex-row justify-between mb-3">
      <span>Deposit Type:</span>
      <ToggleSwitch label="WETH" secondLabel="ETH" on:toggleChange="{() => switchDepositType()}" />
    </div>
  {/if}
  <div class="flex flex-col space-y-4">
    {#if !depositEth}
      {#each Array(activeInputs) as o, i}
        <ComplexInput
          supportedTokens="{$selection.filter((entry) => !entry.selected).map((item) => item.token)}"
          bind:selectedToken="{selectedTokens[i]}"
          bind:inputValue="{inputValues[selectedTokens[i]]}"
          externalMax="{getTokenDataFromBalancesBySymbol(selectedTokens[i], [$balancesStore])?.balance.lt(
            capaToUnits(capa, selectedTokens[i]),
          )
            ? getTokenDataFromBalancesBySymbol(selectedTokens[i], [$balancesStore])?.balance
            : capa}"
          externalDecimals="{getTokenDataFromBalancesBySymbol(selectedTokens[i], [$balancesStore])?.decimals}"
        />
        {#if canAddInputs}
          <Button
            label="+ {$_('vaults_page.add_collateral_type')}"
            on:clicked="{() => addInputs(selectedTokens[i])}"
            py="py-2"
          />
        {/if}
      {/each}
    {:else if depositEth}
      <ComplexInput supportedTokens="{[ethData?.symbol]}" bind:inputValue="{underlyingDeposit}" />
    {/if}
  </div>

  <div class="my-4">
    <MaxLossController bind:maxLoss="{maximumLoss}" maxLossPreset="{maxLossPreset}" />
  </div>

  {#if capInfo.isFull}
    <VaultMessage level="1" message="Vault deposit capacity reached." />
  {:else if isPaused}
    <VaultMessage level="2" message="Vault deposits currently paused." />
  {:else}
    <Button
      label="{$_('actions.deposit')}"
      borderColor="green4"
      backgroundColor="{$settings.invertColors ? 'green7' : 'black2'}"
      hoverColor="green4"
      height="h-12"
      borderSize="1"
      fontSize="text-md"
      on:clicked="{() => onButtonDeposit(yieldDepositBN, underlyingDepositBN)}"
      disabled="{isPaused || depositButtonDisabled}"
    />
  {/if}
{/if}
