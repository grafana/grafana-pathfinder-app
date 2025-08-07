import React from 'react';
import { useStyles2 } from '@grafana/ui';
import { getSkeletonStyles } from '../../styles/skeleton.styles';

export interface SkeletonLoaderProps {
  type?: 'documentation' | 'learning-journey' | 'recommendations';
  className?: string;
}

export function SkeletonLoader({ type = 'documentation', className }: SkeletonLoaderProps) {
  const styles = useStyles2(getSkeletonStyles);

  if (type === 'recommendations') {
    return (
      <div className={`${styles.skeleton} ${className || ''}`}>
        {/* Section Header */}
        <div className={styles.section}>
          <div className={styles.recommendationsHeader}>
            <div className={styles.headerIcon}></div>
            <div className={styles.headerContent}>
              <div className={styles.sectionTitle}></div>
              <div className={styles.sectionSubtitle}></div>
            </div>
          </div>
        </div>

        {/* Primary Recommendations - Simple bars like table rows */}
        <div className={styles.section}>
          <div className={styles.recommendationBars}>
            {[...Array(4)].map((_, index) => (
              <div key={index} className={styles.recommendationBar}>
                <div className={styles.barContent}></div>
                <div className={styles.barButton}></div>
              </div>
            ))}
          </div>
        </div>

        {/* Other Documentation Section (collapsed by default, so just show header) */}
        <div className={styles.section}>
          <div className={styles.otherDocsHeader}>
            <div className={styles.otherDocsIcon}></div>
            <div className={styles.otherDocsTitle}></div>
            <div className={styles.otherDocsCount}></div>
            <div className={styles.otherDocsToggle}></div>
          </div>
        </div>
      </div>
    );
  }

  if (type === 'learning-journey') {
    return (
      <div className={`${styles.skeleton} ${className || ''}`}>
        {/* Journey Header with Progress */}
        <div className={styles.section}>
          <div className={styles.header}></div>
          <div className={styles.progressBar}></div>
        </div>
        
        {/* Journey Content */}
        <div className={styles.section}>
          <div className={styles.subHeader}></div>
          <div className={styles.paragraph}></div>
          <div className={styles.paragraph}></div>
          <div className={styles.paragraph}></div>
        </div>

        {/* Interactive Section */}
        <div className={styles.section}>
          <div className={styles.interactiveHeader}></div>
          <div className={styles.interactiveStep}>
            <div className={styles.stepIcon}></div>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}></div>
              <div className={styles.stepDescription}></div>
            </div>
            <div className={styles.stepButton}></div>
          </div>
          <div className={styles.interactiveStep}>
            <div className={styles.stepIcon}></div>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}></div>
              <div className={styles.stepDescription}></div>
            </div>
            <div className={styles.stepButton}></div>
          </div>
        </div>

        {/* Code Block */}
        <div className={styles.section}>
          <div className={styles.codeBlock}>
            <div className={styles.codeHeader}></div>
            <div className={styles.codeLine}></div>
            <div className={styles.codeLine}></div>
            <div className={styles.codeLine}></div>
            <div className={styles.codeLine}></div>
          </div>
        </div>

        {/* Navigation */}
        <div className={styles.section}>
          <div className={styles.navigationButtons}>
            <div className={styles.navButton}></div>
            <div className={styles.navButton}></div>
          </div>
        </div>
      </div>
    );
  }

  // Documentation skeleton
  return (
    <div className={`${styles.skeleton} ${className || ''}`}>
      {/* Document Header */}
      <div className={styles.section}>
        <div className={styles.header}></div>
        <div className={styles.hr}></div>
      </div>

      {/* Table of Contents */}
      <div className={styles.section}>
        <div className={styles.subHeader}></div>
        <div className={styles.tocItem}>
          <div className={styles.tocBullet}></div>
          <div className={styles.tocText}></div>
        </div>
        <div className={styles.tocItem}>
          <div className={styles.tocBullet}></div>
          <div className={styles.tocText}></div>
        </div>
        <div className={styles.tocItem}>
          <div className={styles.tocBullet}></div>
          <div className={styles.tocText}></div>
        </div>
      </div>

      {/* Content Sections */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}></div>
        <div className={styles.paragraph}></div>
        <div className={styles.paragraph}></div>
        <div className={styles.paragraph}></div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}></div>
        <div className={styles.paragraph}></div>
        <div className={styles.paragraph}></div>
      </div>

      {/* Code Example */}
      <div className={styles.section}>
        <div className={styles.codeBlock}>
          <div className={styles.codeHeader}></div>
          <div className={styles.codeLine}></div>
          <div className={styles.codeLine}></div>
          <div className={styles.codeLine}></div>
          <div className={styles.codeLine}></div>
          <div className={styles.codeLine}></div>
        </div>
      </div>

      {/* Table */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}></div>
        <div className={styles.table}>
          <div className={styles.tableRow}>
            <div className={styles.tableHeader}></div>
            <div className={styles.tableHeader}></div>
            <div className={styles.tableHeader}></div>
            <div className={styles.tableHeader}></div>
          </div>
          <div className={styles.tableRow}>
            <div className={styles.tableCell}></div>
            <div className={styles.tableCell}></div>
            <div className={styles.tableCell}></div>
            <div className={styles.tableCell}></div>
          </div>
          <div className={styles.tableRow}>
            <div className={styles.tableCell}></div>
            <div className={styles.tableCell}></div>
            <div className={styles.tableCell}></div>
            <div className={styles.tableCell}></div>
          </div>
          <div className={styles.tableRow}>
            <div className={styles.tableCell}></div>
            <div className={styles.tableCell}></div>
            <div className={styles.tableCell}></div>
            <div className={styles.tableCell}></div>
          </div>
        </div>
      </div>

      {/* Final Content */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}></div>
        <div className={styles.paragraph}></div>
        <div className={styles.paragraph}></div>
      </div>
    </div>
  );
}
