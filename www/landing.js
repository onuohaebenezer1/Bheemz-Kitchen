       const revealEls = document.querySelectorAll('[data-reveal]');
       if ('IntersectionObserver' in window) {
           const io = new IntersectionObserver((entries) => {
               entries.forEach(e => {
                   if (e.isIntersecting) {
                       e.target.classList.add('in');
                       io.unobserve(e.target);
                   }
               });
           }, {
               threshold: 0.15
           });
           revealEls.forEach(el => io.observe(el));
       } else {
           revealEls.forEach(el => el.classList.add('in'));
       }