import type {ReactNode} from 'react';
import {useCallback, useEffect, useState} from 'react';
import type {Location} from 'history';
import debounce from 'lodash/debounce';
import omit from 'lodash/omit';

import SelectControl from 'sentry/components/forms/controls/selectControl';
import {t} from 'sentry/locale';
import {trackAnalytics} from 'sentry/utils/analytics';
import {uniq} from 'sentry/utils/array/uniq';
import {browserHistory} from 'sentry/utils/browserHistory';
import EventView from 'sentry/utils/discover/eventView';
import {DiscoverDatasets} from 'sentry/utils/discover/types';
import {EMPTY_OPTION_VALUE} from 'sentry/utils/tokenizeSearch';
import {useLocation} from 'sentry/utils/useLocation';
import useOrganization from 'sentry/utils/useOrganization';
import usePageFilters from 'sentry/utils/usePageFilters';
import {useSpansQuery} from 'sentry/views/insights/common/queries/useSpansQuery';
import {buildEventViewQuery} from 'sentry/views/insights/common/utils/buildEventViewQuery';
import {useCompactSelectOptionsCache} from 'sentry/views/insights/common/utils/useCompactSelectOptionsCache';
import {useWasSearchSpaceExhausted} from 'sentry/views/insights/common/utils/useWasSearchSpaceExhausted';
import {QueryParameterNames} from 'sentry/views/insights/common/views/queryParameters';
import {EmptyContainer} from 'sentry/views/insights/common/views/spans/selectors/emptyOption';
import {ModuleName, SpanMetricsField} from 'sentry/views/insights/types';

type Props = {
  additionalQuery?: string[];
  emptyOptionLocation?: 'top' | 'bottom';
  moduleName?: ModuleName;
  spanCategory?: string;
  value?: string;
};

interface DomainData {
  'span.domain': string[];
}

export function DomainSelector({
  value = '',
  moduleName = ModuleName.ALL,
  spanCategory,
  additionalQuery = [],
  emptyOptionLocation = 'bottom',
}: Props) {
  const location = useLocation();
  const organization = useOrganization();
  const pageFilters = usePageFilters();

  const [searchInputValue, setSearchInputValue] = useState<string>(''); // Realtime domain search value in UI
  const [searchQuery, setSearchQuery] = useState<string>(''); // Debounced copy of `searchInputValue` used for the Discover query

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSetSearch = useCallback(
    debounce(newSearch => {
      setSearchQuery(newSearch);
    }, 500),
    []
  );

  const eventView = getEventView(
    location,
    moduleName,
    spanCategory,
    searchQuery,
    additionalQuery
  );

  const {
    data: domainData,
    isLoading,
    pageLinks,
  } = useSpansQuery<DomainData[]>({
    eventView,
    initialData: [],
    limit: LIMIT,
    referrer: 'api.starfish.get-span-domains',
  });

  const wasSearchSpaceExhausted = useWasSearchSpaceExhausted({
    query: searchQuery,
    isLoading,
    pageLinks,
  });

  const incomingDomains = [
    ...uniq(domainData?.flatMap(row => row[SpanMetricsField.SPAN_DOMAIN])),
  ];

  if (value) {
    incomingDomains.push(value);
  }

  const {options: domainOptions, clear: clearDomainOptionsCache} =
    useCompactSelectOptionsCache(
      incomingDomains.filter(Boolean).map(datum => {
        return {
          value: datum,
          label: datum,
        };
      })
    );

  useEffect(() => {
    clearDomainOptionsCache();
  }, [pageFilters.selection.projects, clearDomainOptionsCache]);

  const emptyOption = {
    value: EMPTY_OPTION_VALUE,
    label: (
      <EmptyContainer>{t('(No %s)', LABEL_FOR_MODULE_NAME[moduleName])}</EmptyContainer>
    ),
  };

  const options = [
    {value: '', label: 'All'},
    ...(emptyOptionLocation === 'top' ? [emptyOption] : []),
    ...domainOptions,
    ...(emptyOptionLocation === 'bottom' ? [emptyOption] : []),
  ];

  return (
    <SelectControl
      inFieldLabel={`${LABEL_FOR_MODULE_NAME[moduleName]}:`}
      inputValue={searchInputValue}
      value={value}
      options={options}
      isLoading={isLoading}
      onInputChange={input => {
        setSearchInputValue(input);

        if (!wasSearchSpaceExhausted) {
          debouncedSetSearch(input);
        }
      }}
      onChange={newValue => {
        trackAnalytics('insight.general.select_domain_value', {
          organization,
          source: moduleName,
        });
        browserHistory.push({
          ...location,
          query: {
            ...location.query,
            [SpanMetricsField.SPAN_DOMAIN]: newValue.value,
            [QueryParameterNames.SPANS_CURSOR]: undefined,
          },
        });
      }}
      noOptionsMessage={() => t('No results')}
      styles={{
        control: provided => ({
          ...provided,
          minWidth: MIN_WIDTH,
        }),
      }}
    />
  );
}

const MIN_WIDTH = 300;

const LIMIT = 100;

const LABEL_FOR_MODULE_NAME: {[key in ModuleName]: ReactNode} = {
  http: t('Host'),
  db: t('Table'),
  cache: t('Domain'),
  vital: t('Domain'),
  queue: t('Domain'),
  screen_load: t('Domain'),
  app_start: t('Domain'),
  resource: t('Resource'),
  other: t('Domain'),
  ai: t('Domain'),
  'mobile-ui': t('Domain'),
  '': t('Domain'),
};

function getEventView(
  location: Location,
  moduleName: ModuleName,
  spanCategory?: string,
  search?: string,
  additionalQuery?: string[]
) {
  const query = [
    ...buildEventViewQuery({
      moduleName,
      location: {
        ...location,
        query: omit(location.query, ['span.action', 'span.domain']),
      },
      spanCategory,
    }),
    ...(search && search.length > 0
      ? [`${SpanMetricsField.SPAN_DOMAIN}:*${[search]}*`]
      : []),
    ...(additionalQuery || []),
  ].join(' ');
  return EventView.fromNewQueryWithLocation(
    {
      name: '',
      fields: [SpanMetricsField.SPAN_DOMAIN, 'count()'],
      orderby: '-count',
      query,
      dataset: DiscoverDatasets.SPANS_METRICS,
      version: 2,
    },
    location
  );
}
